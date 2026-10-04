"""Start the stack in dependency order, keep it running, stop it in reverse.

This is the appliance's entrypoint.sh + bootstrap.sh + supervisord, in one
process:

    config -> epmd -> valkey, rabbitmq
                    | initdb -> postgres -> migrations -> frontend
                    | service hosts, loading
           -> service hosts, serving -> proxy -> ready

The backend services run in service hosts (servicehost.py), grouped as the
machine's profile says (resources.py, apps.py).

What takes the time of a start is three things that do not need each other:
RabbitMQ booting, the database being created and migrated (which needs
PostgreSQL alone), and each service host importing the backend. They run
side by side. A host is started as soon as its environment is known, loads,
and then waits for the supervisor's word (the go file) before it starts a
service: no service runs before the databases answer, the migrations are in
and interrupted runs are settled. timing.py reports how long each part took.

Processes are kept in tiers; those in a tier do not depend on each other.
Tiers stop in reverse order, each one all at once. Like supervisord's two
stop groups, that takes the stateless services away first so the data stores
get a quiet, clean shutdown.
"""

from __future__ import annotations

import contextlib
import logging
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import NoReturn

from autogpt_desktop import (
    apps,
    bootstrap,
    claude_code,
    events,
    migrations,
    ports,
    postgres,
    rabbitmq,
    resources,
    runs,
    servicehost,
    settings,
    timing,
    valkey,
)
from autogpt_desktop.layout import Bundle, DataDir
from autogpt_desktop.process import (
    ChildRegistry,
    ManagedProcess,
    adopt_kill_on_exit_job,
    base_env,
    listening,
    raise_file_limit,
    stop_together,
    wait_until,
)
from autogpt_desktop.proxy import ProxyThread, Upstreams

logger = logging.getLogger("autogpt_desktop")

MAX_RESTARTS = 3
RESTART_WINDOW_SECONDS = 300
APP_READY_TIMEOUT_SECONDS = 300
# Once the window can open: how long the services it does not talk to
# (apps.NEEDED_TO_OPEN) get to answer before the app is opened without them.
OTHER_SERVICES_SECONDS = 90
# The skills catalog is published by one more backend interpreter, 700 MB
# while it runs. Not while the app is starting and the user first clicks.
SKILLS_CATALOG_DELAY_SECONDS = 60
SKILLS_CATALOG_MARKER = "skills-catalog.published"
# In the data directory's run/: written when the services may start.
GO_FILE = "services.go"
# What the shell allows a stop before it kills the runtime (src/runtime.js).
SHELL_STOP_GRACE_SECONDS = 60
# How often a server that is starting is asked whether it answers yet. What
# is asked is cheap while the answer is no (process.listening).
READY_POLL_SECONDS = 0.25
PASSWORD_RESET_LOST = (
    "The owner password was not changed, because AutoGPT did not finish "
    "starting. Reset it again."
)


class StartupError(RuntimeError):
    pass


class Abandoned(StartupError):
    """One side of a start gave up because the other had already failed.
    What the other side raised is the reason the user is given."""


class Stack:
    def __init__(self, bundle: Bundle, data: DataDir) -> None:
        self.bundle = bundle
        self.data = data
        self.tiers: list[list[ManagedProcess]] = []
        self.proxy: ProxyThread | None = None
        self.registry = ChildRegistry(data.run / "children.json")
        self.restarts: dict[str, list[float]] = {}
        self.stop_requested = threading.Event()
        self.env: dict[str, str] = {}
        self.oneshot: ManagedProcess | None = None
        self.migrating = False
        self.password_reset: str | None = None
        self.profile = resources.Profile(resources.BALANCED, "not chosen yet", {})
        self.cache = runs.Cache(0, "")
        # Process name -> the services it hosts.
        self.hosts: dict[str, apps.Group] = {}
        self.ready_at: float | None = None
        # The bundle version a running publish is for; None once settled.
        self.publishing: str | None = None
        self.user: dict[str, str] = {}
        self.claude_code: claude_code.Detection | None = None
        # What the copilot executor's process gets in place of `env`, when
        # AutoPilot runs on the user's Claude Code sign-in.
        self.copilot_env: dict[str, str] | None = None
        self.phases = timing.Phases()
        self.hosts_launched = 0.0
        self.frontend_launched = 0.0
        # The two sides of a start, each on a thread of its own: the cache
        # and the broker, and everything the database needs.
        self.servers_branch: Background | None = None
        self.database_branch: Background | None = None
        # Set when one side has failed: the other begins nothing more.
        self.start_failed = threading.Event()
        # Started hosts load and then wait for this file (servicehost.py).
        self.go_file = data.run / GO_FILE
        self.cache_is_up = threading.Event()
        # Held to start a process and to write down what is running: both
        # sides of a start do, and the record is one file.
        self._launching = threading.RLock()

    @property
    def processes(self) -> list[ManagedProcess]:
        return [process for tier in self.tiers for process in tier]

    def run(self) -> int:
        try:
            return self.run_until_stopped()
        finally:  # whatever happened, nothing started here is left running
            self.stop()

    def run_until_stopped(self) -> int:
        try:
            url = self.start()
        except Exception as exc:
            cancelled = self.stop_requested.is_set()
            lost = self.forget_password_reset()
            if not cancelled:
                logger.exception("startup failed")
                events.error(f"{exc} {lost}".strip(), fatal=True)
            return 0 if cancelled else 1
        events.ready(url)
        self.ready_at = time.monotonic()
        return self.watch()

    def request_stop(self) -> None:
        """The shell asked for a stop. It kills a runtime that takes too long
        over one, so say so when this stop has a good reason to be slow."""
        self.stop_requested.set()
        if self.migrating:
            events.stopping(
                "Finishing a database update before closing",
                bootstrap.MIGRATION_TIMEOUT_SECONDS + SHELL_STOP_GRACE_SECONDS,
            )

    def forget_password_reset(self) -> str:
        """The password file is deleted as soon as it is read, so a start that
        ends before the reset is applied has lost it. Say so: the owner, who
        does not know the old password, would otherwise find the new one
        refused with no hint why."""
        if self.password_reset is None:
            return ""
        self.password_reset = None
        logger.warning(PASSWORD_RESET_LOST)
        return PASSWORD_RESET_LOST

    def raise_if_cancelled(self) -> None:
        if self.stop_requested.is_set():
            raise StartupError("startup was cancelled")

    def raise_if_abandoned(self) -> None:
        """Asked before each thing a side of the start begins. What is
        already running (a migration above all) is never cut short by it."""
        self.raise_if_cancelled()
        if self.start_failed.is_set():
            raise Abandoned("the other side of this start failed")

    def start(self) -> str:
        bundle, data = self.bundle, self.data
        self.phases = timing.Phases()
        # First, ahead of anything that can fail: whatever happens to this
        # start, the password does not stay on disk in the clear.
        self.password_reset = bootstrap.take_password_reset(
            data.config / bootstrap.RESET_PASSWORD_FILE
        )
        # What this machine lacks (Linux: OpenSSL 3) is said in the first
        # second, not once a database has been created for nothing.
        migrations.require_engines(bundle)
        events.progress("config", "Preparing configuration")
        data.prepare()
        self.registry.reap_leftovers()
        self.go_file.unlink(missing_ok=True)
        settings.clear_copilot_workspaces(data)
        secret = settings.ensure_secrets(bundle, data)
        port = ports.allocate(data.ports_file)
        self.user = user = settings.read_user_settings(data)
        self.profile = resources.choose(user)
        events.progress("profile", self.profile.describe())
        self.env = settings.backend_environment(
            bundle, data, port, secret, user, self.profile.backend_env
        )
        self.claude_code = self.look_for_claude_code()
        first_boot = not postgres.is_initialized(data)
        self.phases.record("config", self.phases.since_start())
        cache_and_queue = self.start_infrastructure(port, secret, first_boot)
        self.load_services(port, secret)
        self.settle(cache_and_queue)
        runs.reconcile(
            self.database_connector(port["postgres"], secret["POSTGRES_PASSWORD"]),
            data.run / runs.STOPPED_RUNS_FILE,
        )
        self.start_apps(port, secret)
        self.phases.finish()
        return self.env["AUTOGPT_PUBLIC_URL"]

    def look_for_claude_code(self) -> claude_code.Detection:
        """In the background, while the databases start: it asks the CLI and
        then the backend, which takes a few seconds."""
        env, user, home = dict(self.env), self.user, claude_code.real_home()

        def as_the_host_gets_it(cli: Path | None) -> dict[str, str]:
            host = settings.claude_code_host_environment(env, self.data, user, home, cli)
            return claude_code.service_environment(host)

        return claude_code.Detection(
            lambda: claude_code.detect(self.bundle, self.data, user, as_the_host_gets_it, home)
        )

    def use_claude_code(self) -> None:
        """Say what was found, and with a sign-in to use, turn it on: for
        every service (the API decides which engine a turn gets), and the
        real home for the copilot executor, in a process of its own
        (start_apps)."""
        if self.claude_code is None:
            return
        found = self.claude_code.result()
        events.claude_code(
            found.state,
            found.describe(),
            str(found.cli) if found.cli else None,
            found.version,
            found.bundled,
        )
        if not found.in_use:
            return
        self.env[settings.CLAUDE_SUBSCRIPTION] = "true"
        self.copilot_env = settings.claude_code_host_environment(
            self.env, self.data, self.user, claude_code.real_home(), found.host_cli
        )

    def start_infrastructure(
        self, port: dict[str, int], secret: dict[str, str], first_boot: bool
    ) -> Callable[[], None]:
        """Start Valkey and RabbitMQ and wait for them on one thread, and on
        another do everything the database needs: created (a first start),
        started, migrated. Returns the wait for the first two; `settle` makes
        it and then waits for the database's side. RabbitMQ boots as slowly
        as a database is created, and neither needs the other.

        The wait has a thread of its own so that each server is asked from
        the moment it is started: what the main thread does meanwhile
        (starting the hosts, waiting for the look for Claude Code) would
        otherwise be counted as the cache's and the broker's time."""
        bundle, data = self.bundle, self.data
        events.progress(
            "infrastructure",
            "Setting up the database (first start only)"
            if first_boot
            else "Starting the database and message queue",
        )
        rabbit_user = secret["RABBITMQ_DEFAULT_USER"]
        rabbit_password = secret["RABBITMQ_DEFAULT_PASS"]
        valkey.write_config(
            data, port["valkey"], port["valkey_bus"], secret["REDIS_PASSWORD"]
        )
        rabbitmq.prepare(data, port["rabbitmq"], rabbit_user, rabbit_password)

        port_mapper = rabbitmq.epmd_process(bundle, data, port)
        self.launch([port_mapper])
        # Before anything is created or started on this data: a database this
        # build cannot open is the user's to keep.
        postgres.check_compatible(bundle, data)
        self.await_ready(
            port_mapper, lambda: rabbitmq.epmd_is_ready(port["epmd"]), timeout=30
        )

        cache = valkey.process(bundle, data, port["valkey"], secret["REDIS_PASSWORD"])
        queue = rabbitmq.process(bundle, data, port)
        began = time.monotonic()
        servers = self.launch([cache, queue])
        self.database_branch = Background(
            lambda: self.start_database(servers, port, secret, first_boot)
        )

        def cache_and_queue() -> None:
            try:
                self.await_cache(cache, port, secret["REDIS_PASSWORD"])
                valkey.ensure_cluster(port["valkey"], secret["REDIS_PASSWORD"])
                self.cache_is_up.set()
                self.phases.record("cache", time.monotonic() - began)
                self.await_queue(queue, port, rabbit_user, rabbit_password)
                self.phases.record("queue", time.monotonic() - began)
            except BaseException:
                # At once, not when `settle` gets to hear of it: the
                # database's side then creates and migrates nothing more.
                self.start_failed.set()
                raise

        self.servers_branch = Background(cache_and_queue)
        return self.servers_branch.result

    def start_database(
        self,
        servers: list[ManagedProcess],
        port: dict[str, int],
        secret: dict[str, str],
        first_boot: bool,
    ) -> None:
        """The database's side of a start, from nothing to migrated."""
        bundle, data = self.bundle, self.data
        with self.phases.measure("database"):
            self.raise_if_abandoned()
            postgres.initialize(bundle, data, secret["POSTGRES_PASSWORD"])
            self.raise_if_abandoned()
            database = postgres.process(
                bundle, data, port["postgres"], resources.POSTGRES_LIMITS
            )
            self.launch_into(servers, database)
            self.await_ready(
                database,
                lambda: postgres.is_ready(port["postgres"], secret["POSTGRES_PASSWORD"]),
                timeout=120,
            )
        with self.phases.measure("migrations"):
            self.migrate(port, secret, first_boot)
        # What is still being waited for, if anything is: the broker, and the
        # hosts loading.
        events.progress("loading", "Loading AutoGPT")
        self.start_frontend(port, secret)

    def start_frontend(self, port: dict[str, int], secret: dict[str, str]) -> None:
        """Once the migrations are in: its environment says whether
        registration is open, which their last step decided (`secure_owner`),
        and it signs in to the database as the role they set up. It needs
        neither the broker nor the backend to start. A tier of its own."""
        self.raise_if_abandoned()
        frontend_env = settings.frontend_environment(self.env, port, secret, self.data)
        frontend = apps.frontend_process(self.bundle, self.data, frontend_env)
        self.frontend_launched = time.monotonic()
        self.launch([frontend])
        self.time_the_frontend(frontend, apps.health_urls(port)[apps.FRONTEND])

    def time_the_frontend(self, frontend: ManagedProcess, url: str) -> None:
        """Its phase ends when it answers. The start itself asks only once
        the broker is up and the hosts have their go (`wait_for_apps`), and
        what it saw then was the broker's time under the frontend's name."""
        launched = self.frontend_launched

        def watch() -> None:
            deadline = launched + APP_READY_TIMEOUT_SECONDS
            while time.monotonic() < deadline and frontend.exit_code() is None:
                if self.stop_requested.is_set() or self.start_failed.is_set():
                    return
                if _http_ok(url):
                    self.phases.record("frontend", time.monotonic() - launched)
                    return
                time.sleep(READY_POLL_SECONDS)

        threading.Thread(target=watch, name="frontend-timing", daemon=True).start()

    def settle(self, waiting: Callable[[], None]) -> None:
        """Make the wait for the cache and the broker, then wait for the
        database's side, and raise what either raised.

        Whatever happens to the first wait, the database's side is seen to
        its end before this returns or raises: what follows a failed start
        is a stop of every server, and a migration that loses its database
        half-way leaves one that has to be repaired by hand. It is told of
        the failure, though, and begins nothing it has not begun: no
        database is created, migrated or given a frontend for a start that
        has already failed. When both fail, the database's error is the one
        reported; the other is in the log."""
        branch = self.database_branch
        assert branch, "start_infrastructure starts the database"
        try:
            waiting()
        except Exception as exc:
            self.start_failed.set()
            if self.migrating:
                events.progress("migrate", "Finishing a database update")
            failed = branch.wait()
            if failed is None or isinstance(failed, Abandoned) or self.stop_requested.is_set():
                raise
            logger.error(f"besides the database, which is the error reported: {exc}")
            raise failed from None
        failed = branch.wait()
        if failed:
            raise failed

    def await_queue(
        self, queue: ManagedProcess, port: dict[str, int], user: str, password: str
    ) -> None:
        """RabbitMQ is started the quick way (rabbitmq.py, `_server_flags`),
        which leans on how this version of it boots. A broker that exits
        instead of starting gets one more start, the way its own script
        would have started it."""

        def answers() -> bool:
            return rabbitmq.is_ready(port["rabbitmq"], user, password)

        try:
            self.await_ready(queue, answers, timeout=240)
        except StartupError:
            exited = queue.exit_code() is not None
            if not exited or self.stop_requested.is_set() or self.database_failed():
                raise
            if not rabbitmq.start_the_plain_way(queue):
                raise
            logger.warning(
                f"rabbitmq exited while starting (see {self.log_of(queue)}); starting it "
                "again without the flags that skip its own distribution set-up"
            )
            self.relaunch(queue)
            self.await_ready(queue, answers, timeout=240)

    def await_cache(self, cache: ManagedProcess, port: dict[str, int], password: str) -> None:
        """Valkey exits at once when it cannot read its files (another build
        wrote them, or they are damaged). They are expendable; start empty."""

        def answers() -> bool:
            return valkey.is_ready(port["valkey"], password)

        try:
            self.await_ready(cache, answers, timeout=60)
        except StartupError:
            if cache.exit_code() is None or self.stop_requested.is_set():
                raise
            valkey.set_aside(self.data)
            valkey.write_config(self.data, port["valkey"], port["valkey_bus"], password)
            self.relaunch(cache)
            self.await_ready(cache, answers, timeout=60)

    def migrate(
        self, port: dict[str, int], secret: dict[str, str], first_boot: bool
    ) -> None:
        events.progress(
            "migrate",
            "Creating the database tables (first start only)"
            if first_boot
            else "Checking for database updates",
        )
        self.raise_if_abandoned()
        connect = self.database_connector(port["postgres"], secret["POSTGRES_PASSWORD"])
        bootstrap.create_schemas(self.bundle, connect)
        bootstrap.refuse_interrupted_migration(connect)
        # A migration that is cut short leaves a database that needs repair by
        # hand. Once it starts it runs to the end, and a stop request waits.
        self.migrating = True
        try:
            self.raise_if_abandoned()
            bootstrap.remove_owner_trigger(connect)
            bootstrap.apply_migrations(self.bundle, self.env)
        finally:
            self.migrating = False
        bootstrap.configure_frontend_role(
            self.bundle, connect, secret["AUTOGPT_FRONTEND_DB_PASSWORD"]
        )
        self.secure_owner(connect)
        postgres.first_run_completed(self.data)

    def secure_owner(self, connect) -> None:
        """The first account is the owner; once it exists, registration is
        closed unless settings.env reopens it. `start_apps` hands the frontend
        its environment after this, so the gate can still be set here."""
        configured = self.env.get("AUTH_ALLOW_NEW_ACCOUNTS")
        identities = bootstrap.ensure_owner(
            connect, settings.closes_registration(configured)
        )
        self.env["AUTH_ALLOW_NEW_ACCOUNTS"] = settings.registration_gate(
            configured, identities
        )
        password, self.password_reset = self.password_reset, None
        if password:
            bootstrap.reset_owner_password(connect, password)

    def load_services(self, port: dict[str, int], secret: dict[str, str]) -> None:
        """Start the service hosts. Each imports the backend, which is most
        of what a start takes, and then waits for the go file: `start_apps`
        writes it once there is something for a service to connect to."""
        bundle, data = self.bundle, self.data
        self.raise_if_cancelled()
        self.use_claude_code()
        self.cache = runs.Cache(port["valkey"], secret["REDIS_PASSWORD"], self.cache_is_up)
        groups = apps.layout(self.profile.merged)
        if self.copilot_env:
            groups = apps.copilot_alone(groups)
        self.hosts = {group.name: group for group in groups}
        env, copilot_env = self.host_environments()
        hosts = apps.backend_processes(bundle, data, env, groups, self.cache, copilot_env)
        self.hosts_launched = time.monotonic()
        # A tier of its own, so that it stops after the services whose way
        # to the database it is: their cleanup still has things to write.
        self.launch([host for host in hosts if host.name == apps.DATABASE_MANAGER])
        self.launch([host for host in hosts if host.name != apps.DATABASE_MANAGER])

    def host_environments(self) -> tuple[dict[str, str], dict[str, str] | None]:
        """What `apps.backend_processes` is given as `env` and `copilot_env`:
        the services' environment, and where the host waits for the go."""
        wait = {servicehost.GO_FILE_ENV: str(self.go_file)}
        copilot = {**self.copilot_env, **wait} if self.copilot_env else None
        return {**self.env, **wait}, copilot

    def start_apps(self, port: dict[str, int], secret: dict[str, str]) -> None:
        """Everything a service needs is there now: let the hosts start
        theirs, and wait for them and the frontend to answer."""
        self.raise_if_cancelled()
        events.progress("services", "Starting AutoGPT")
        if not self.hosts:
            self.load_services(port, secret)
        if not self.frontend_launched:
            self.start_frontend(port, secret)

        self.proxy = ProxyThread(
            Upstreams(
                public_url=self.env["AUTOGPT_PUBLIC_URL"],
                rest=f"http://127.0.0.1:{port['agent_api']}",
                websocket=f"http://127.0.0.1:{port['websocket']}",
                frontend=f"http://127.0.0.1:{port['frontend']}",
            ),
            port["public"],
        )
        self.proxy.start()
        self.give_the_go()
        self.wait_for_apps(port)
        self.record()

    def give_the_go(self) -> None:
        """Let the hosts start their services. The locks of executors that
        are gone go first: a host's own preparation ran when it was started,
        before there was a cache to clear them from (runs.py)."""
        self.cache_is_up.set()
        for group in self.hosts.values():
            self.cache.clear_stale_locks(group.services)
        self.go_file.parent.mkdir(parents=True, exist_ok=True)
        self.go_file.write_text("go\n", encoding="ascii")

    def launch(self, tier: list[ManagedProcess]) -> list[ManagedProcess]:
        """Start a tier. Returned so that a process which could only be
        started later can still join it (`launch_into`)."""
        started: list[ManagedProcess] = []
        self.tiers.append(started)
        for process in tier:
            self.launch_into(started, process)
        return started

    def launch_into(self, tier: list[ManagedProcess], process: ManagedProcess) -> None:
        # One at a time: each side of a start launches on its own thread.
        with self._launching:
            process.start()
            tier.append(process)
            self.record()

    def relaunch(self, process: ManagedProcess) -> None:
        """Start again a process that is in a tier already."""
        with self._launching:
            process.start()
            self.record()

    def record(self) -> None:
        # Under the lock from the list being read to the file being written:
        # a list read before another thread's launch must not be the one
        # that is written after it.
        with self._launching:
            oneshot = [self.oneshot] if self.oneshot else []
            self.registry.record([*self.processes, *oneshot])

    def await_ready(
        self, process: ManagedProcess, probe: Callable[[], bool], timeout: float
    ) -> None:
        """Wait for a service to answer, but not past the point of knowing it
        never will: a process that has exited, or a stop request, ends the
        wait at once instead of running out the timeout."""

        def settled() -> bool:
            if self.stop_requested.is_set() or process.exit_code() is not None:
                return True
            return self.start_failed.is_set() or self.database_failed() or probe()

        wait_until(settled, timeout, interval=READY_POLL_SECONDS)
        self.raise_if_abandoned()
        if self.database_failed():
            # No reason to wait for anything else; `settle` reports why.
            raise StartupError("the database did not start")
        log = self.data.logs / f"{process.name}.log"
        if process.exit_code() is not None:
            raise StartupError(f"{process.name} exited while starting. See {log} for details.")
        if not probe():
            raise StartupError(f"{process.name} did not start. See {log} for details.")

    def database_failed(self) -> bool:
        """Whether the database's side of this start has ended in an error
        (asked from the other side; the branch itself is still running while
        it waits for anything)."""
        branch = self.database_branch
        return bool(branch and branch.failed)

    def wait_for_apps(self, port: dict[str, int]) -> None:
        """The app is ready when what the window talks to answers
        (apps.NEEDED_TO_OPEN). The other services are expected to answer as
        well: a host can be running while a service inside it never came up.
        But where each of them answers is upstream's to change, so they hold
        the app up only for a while, and then it opens with a warning that
        names them."""
        waiting = apps.health_urls(port)
        usable_since: list[float] = []
        asking = ThreadPoolExecutor(max_workers=len(waiting), thread_name_prefix="health")

        def settled() -> bool:
            if self.stop_requested.is_set():
                return True
            for process in self.applications():
                if process.exit_code() is not None and not self.isolate(process):
                    raise StartupError(
                        f"{process.name} exited while starting. "
                        f"See {self.log_of(process)} for details."
                    )
            for name in answering(asking, waiting):
                del waiting[name]
                self.answered(name, waiting)
            if apps.NEEDED_TO_OPEN & waiting.keys():
                return False
            if not usable_since:
                usable_since.append(time.monotonic())
            return not waiting or time.monotonic() - usable_since[0] >= OTHER_SERVICES_SECONDS

        with asking:
            wait_until(settled, APP_READY_TIMEOUT_SECONDS, interval=READY_POLL_SECONDS)
        self.raise_if_cancelled()
        if apps.NEEDED_TO_OPEN & waiting.keys():
            raise StartupError(
                f"AutoGPT did not become ready in time: no answer from {', '.join(waiting)}"
            )
        if waiting:
            silent = ", ".join(f"{name} (at {port[apps.health_port(name)]})" for name in waiting)
            logger.warning(
                f"no answer from {silent} after {OTHER_SERVICES_SECONDS}s; opening the app "
                "without waiting longer. If their logs show them running, the backend "
                "changed where they answer: see SERVICES in autogpt_desktop/apps.py."
            )

    def answered(self, name: str, waiting: dict[str, str]) -> None:
        now = time.monotonic()
        if name == apps.FRONTEND:
            self.phases.record("frontend", now - self.frontend_launched)
        elif not (apps.NEEDED_TO_OPEN - {apps.FRONTEND}) & waiting.keys():
            self.phases.record("services", now - self.hosts_launched)

    def applications(self) -> list[ManagedProcess]:
        ours = {*self.hosts, apps.FRONTEND}
        return [process for process in self.processes if process.name in ours]

    def isolate(self, process: ManagedProcess) -> bool:
        """A host of several services that exited saying upstream no longer
        fits it (servicehost.EXIT_CONTRACT) is replaced by a host for each of
        its services, which can run them the way upstream would. An upstream
        change costs memory that way, not the app."""
        group = self.hosts.get(process.name)
        if process.exit_code() != servicehost.EXIT_CONTRACT or not group or not group.merged:
            return False
        logger.warning(
            f"{process.name} cannot host {', '.join(group.services)} together with this "
            f"backend (see {self.log_of(process)}); starting a process for each"
        )
        # After this it is in no tier, and no stop would reach what it started
        # (a query engine, once a worker has connected to the database).
        process.kill()
        tier = next(tier for tier in self.tiers if process in tier)
        tier.remove(process)
        del self.hosts[process.name]
        groups = apps.isolated((group,))
        env, copilot_env = self.host_environments()
        replacements = apps.backend_processes(
            self.bundle, self.data, env, groups, self.cache, copilot_env
        )
        for replacement, single in zip(replacements, groups, strict=True):
            replacement.start()
            tier.append(replacement)
            self.hosts[single.name] = single
            self.record()
        return True

    def log_of(self, process: ManagedProcess) -> str:
        return str(self.data.logs / f"{process.name}.log")

    def database_connector(self, port: int, password: str):
        import psycopg2

        def connect():
            return psycopg2.connect(
                host="127.0.0.1",
                port=port,
                user="postgres",
                password=password,
                dbname="postgres",
                connect_timeout=10,
            )

        return connect

    def tend_skills_catalog(self) -> None:
        """Publish the catalog once the app has been up for a minute, in the
        background (the appliance blocks boot on it for up to ten minutes,
        which a desktop user would read as a hang), and only when this
        bundle has not published it into this data directory before."""
        if self.oneshot is None:
            ready_for = time.monotonic() - (self.ready_at or time.monotonic())
            if ready_for >= SKILLS_CATALOG_DELAY_SECONDS:
                self.publish_skills_catalog()
            return
        code = self.oneshot.exit_code()
        if code is None or self.publishing is None:
            return
        version, self.publishing = self.publishing, None
        if code != 0:
            logger.warning(
                f"the skills catalog was not published (exit code {code}); the next "
                f"start tries again. See {self.log_of(self.oneshot)}."
            )
            return
        logger.info("published the skills catalog")
        with contextlib.suppress(OSError):
            (self.data.config / SKILLS_CATALOG_MARKER).write_text(version, encoding="utf-8")

    def publish_skills_catalog(self) -> None:
        process = ManagedProcess(
            name="skills-catalog",
            argv=apps.entry_point_argv(
                self.bundle, apps.SKILLS_CATALOG_ENTRY, "--skip-missing-preloads"
            ),
            env={**base_env(), **self.env},
            cwd=self.bundle.backend_dir,
            log_dir=self.data.logs,
        )
        self.oneshot = process  # started or not, this start is done with it
        try:
            version = apps.bundle_version(self.bundle)
            if self.published_catalog() == version:
                logger.info("the skills catalog of this version is already published")
                return
            process.start()
        except OSError as exc:
            logger.warning(f"could not start the skills catalog publish: {exc}")
            return
        self.publishing = version
        self.record()

    def published_catalog(self) -> str | None:
        try:
            return (self.data.config / SKILLS_CATALOG_MARKER).read_text(encoding="utf-8").strip()
        except OSError:
            return None

    def watch(self) -> int:
        while not self.stop_requested.wait(2):
            for process in self.processes:
                code = process.exit_code()
                if code is None or self.isolate(process):
                    continue
                if code == servicehost.EXIT_CONTRACT and process.name in self.hosts:
                    events.error(
                        f"{process.name} cannot run with this version of the backend. "
                        f"See {self.log_of(process)}.",
                        fatal=True,
                    )
                    return 1
                if not self.may_restart(process.name):
                    events.error(
                        f"{process.name} keeps stopping (exit code {code}). "
                        f"See {self.log_of(process)}.",
                        fatal=True,
                    )
                    return 1
                logger.warning(f"{process.name} exited with code {code}; restarting it")
                process.start()
                self.record()
            self.tend_skills_catalog()
        return 0

    def may_restart(self, name: str) -> bool:
        now = time.monotonic()
        recent = [t for t in self.restarts.get(name, []) if now - t < RESTART_WINDOW_SECONDS]
        recent.append(now)
        self.restarts[name] = recent
        return len(recent) <= MAX_RESTARTS

    def stop(self) -> None:
        self.stop_requested.set()
        for branch in (self.servers_branch, self.database_branch):
            # Never under a migration: it ends by itself, and is not long.
            # Nor while the other side could still start a server again.
            if branch:
                branch.wait()
        if self.proxy:
            try:
                self.proxy.stop()
            except Exception as exc:
                logger.warning(f"proxy did not stop cleanly: {exc}")
        oneshot = [self.oneshot] if self.oneshot else []
        for tier in reversed([*self.tiers, oneshot]):
            stop_together(tier)
        self.registry.path.unlink(missing_ok=True)


class Background:
    """Work done on a thread of its own, and what it raised."""

    def __init__(self, work: Callable[[], None]) -> None:
        self.failed: BaseException | None = None
        self.thread = threading.Thread(target=self.run, args=(work,), name="background")
        self.thread.start()

    def run(self, work: Callable[[], None]) -> None:
        try:
            work()
        except BaseException as exc:
            self.failed = exc

    def wait(self) -> BaseException | None:
        """Until the work has ended, however long that takes; what it raised."""
        self.thread.join()
        return self.failed

    def result(self) -> None:
        """Wait, and raise here what the work raised."""
        failed = self.wait()
        if failed:
            raise failed


def answering(asking: ThreadPoolExecutor, waiting: dict[str, str]) -> list[str]:
    """Of the services in `waiting` (name -> health address), those that
    answer now. Asked all at once: one that is not up yet costs its own
    wait, not everybody's."""
    names = list(waiting)
    answers = asking.map(lambda name: _http_ok(waiting[name]), names)
    return [name for name, answered in zip(names, answers, strict=True) if answered]


def serve() -> NoReturn:
    events.configure_logging()
    adopt_kill_on_exit_job()
    raise_file_limit()
    stack = Stack(Bundle.locate(), DataDir.locate())
    _stop_on_signals(stack)
    _stop_when_stdin_closes(stack)
    code = stack.run()
    # Skip interpreter finalization: every service is already stopped, and
    # library threads (aiohttp, pika, the stdin watcher) must not be able to
    # turn a clean shutdown into a hang or a crash report.
    with contextlib.suppress(OSError, ValueError):  # the shell may be gone
        sys.stdout.flush()
        sys.stderr.flush()
    os._exit(code)


def _stop_on_signals(stack: Stack) -> None:
    def handler(signum, frame):
        stack.stop_requested.set()

    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)


def _stop_when_stdin_closes(stack: Stack) -> None:
    """The shell closes our stdin to ask for shutdown, and the OS closes it
    for us if the shell dies. A terminal run (stdin is a TTY) uses Ctrl+C."""
    if sys.stdin is None or sys.stdin.isatty():
        return

    descriptor = sys.stdin.fileno()

    def wait_for_eof() -> None:
        # Read the raw descriptor, not sys.stdin: a thread parked inside the
        # buffered reader holds its lock, and CPython aborts at exit when it
        # cannot take that lock back from a daemon thread.
        try:
            while os.read(descriptor, 4096):
                pass
        except OSError:
            pass
        stack.request_stop()

    threading.Thread(target=wait_for_eof, name="stdin-watch", daemon=True).start()


def _http_ok(url: str) -> bool:
    if not listening(urllib.parse.urlsplit(url).port or 80):
        return False
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            return response.status < 500
    except urllib.error.HTTPError as exc:
        return exc.code < 500
    except (urllib.error.URLError, OSError):
        return False
