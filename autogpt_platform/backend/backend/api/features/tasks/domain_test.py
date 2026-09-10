import importlib


def test_capture_and_human_assignment_do_not_start_execution():
    domain = importlib.import_module("backend.api.features.tasks.domain")
    models = importlib.import_module("backend.api.features.tasks.models")
    task = models.WorkspaceTask(id="task", user_id="owner", title="Choose a date")
    task.suggestion = models.TaskAssignee(kind="auto", id="auto", name="Auto")
    assert not domain.is_runnable(task, [task])
    task.assignee = models.TaskAssignee(kind="human", id="owner", name="You")
    assert not domain.is_runnable(task, [task])
    assert task.status == "todo"


def test_branch_hold_and_unfinished_dependency_prevent_dispatch():
    domain = importlib.import_module("backend.api.features.tasks.domain")
    models = importlib.import_module("backend.api.features.tasks.models")
    parent = models.WorkspaceTask(
        id="parent", user_id="owner", title="Launch", plan_only=True
    )
    child = models.WorkspaceTask(
        id="child",
        user_id="owner",
        title="Draft",
        parent_id="parent",
        assignee=models.TaskAssignee(kind="auto", id="auto", name="Auto"),
    )
    assert not domain.is_runnable(child, [parent, child])
    parent.plan_only = False
    assert domain.is_runnable(child, [parent, child])
    child.dependencies = ["parent"]
    assert not domain.is_runnable(child, [parent, child])


def test_progress_counts_required_leaves_and_only_accepted_results():
    domain = importlib.import_module("backend.api.features.tasks.domain")
    models = importlib.import_module("backend.api.features.tasks.models")
    tasks = [
        models.WorkspaceTask(id="parent", user_id="u", title="Launch"),
        models.WorkspaceTask(
            id="done", user_id="u", title="Draft", parent_id="parent", status="done"
        ),
        models.WorkspaceTask(
            id="review",
            user_id="u",
            title="Research",
            parent_id="parent",
            status="needs_you",
        ),
        models.WorkspaceTask(
            id="proposal",
            user_id="u",
            title="New scope",
            parent_id="parent",
            accepted=False,
        ),
        models.WorkspaceTask(
            id="cancel",
            user_id="u",
            title="Old scope",
            parent_id="parent",
            status="canceled",
        ),
    ]
    assert domain.progress("parent", tasks) == (1, 2)


def test_progress_excludes_descendants_of_removed_scope():
    domain = importlib.import_module("backend.api.features.tasks.domain")
    models = importlib.import_module("backend.api.features.tasks.models")
    for exclusion in ({"accepted": False}, {"required": False}, {"status": "canceled"}):
        tasks = [
            models.WorkspaceTask(id="root", user_id="u", title="Outcome"),
            models.WorkspaceTask(
                id="branch", user_id="u", title="Removed", parent_id="root", **exclusion
            ),
            models.WorkspaceTask(
                id="leaf", user_id="u", title="Nested", parent_id="branch"
            ),
            models.WorkspaceTask(
                id="done", user_id="u", title="Kept", parent_id="root", status="done"
            ),
        ]
        assert domain.progress("root", tasks) == (1, 1)


def test_child_results_wake_a_blocked_coordinator_once():
    models = importlib.import_module("backend.api.features.tasks.models")
    repository = importlib.import_module("backend.api.features.tasks.repository")
    parent = models.WorkspaceTask(
        id="parent",
        user_id="u",
        title="Outcome",
        status="blocked",
        dispatch_state="finished",
        assignee=models.TaskAssignee(kind="auto", id="auto", name="Auto"),
    )
    child = models.WorkspaceTask(
        id="child",
        user_id="u",
        title="Research",
        parent_id="parent",
        result="Evidence",
        result_version=1,
        status="needs_you",
        dispatch_state="finished",
    )
    repository._prepare_dispatches([parent, child])
    assert parent.dispatch_state == "pending" and parent.dispatch_message
    parent.status, parent.dispatch_state = "blocked", "finished"
    repository._prepare_dispatches([parent, child])
    assert parent.dispatch_state == "finished"
    child.status = "done"
    repository._prepare_dispatches([parent, child])
    assert parent.dispatch_state == "pending"
