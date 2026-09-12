from prisma import Prisma

from backend.api.features.tasks.models import WorkspaceTask
from backend.data.db import execute_raw_with_schema
from backend.util.json import dumps


async def sync_task_question(tx: Prisma, task: WorkspaceTask) -> None:
    if not task.session_id or not task.question:
        return
    question = task.question
    if question.answers is None and task.status not in ("done", "canceled"):
        await execute_raw_with_schema(
            'UPDATE {schema_prefix}"ChatSession" SET "metadata" = '
            "COALESCE(\"metadata\", '{{}}'::jsonb) || "
            "jsonb_build_object('pending_question', $3::jsonb) "
            'WHERE "id" = $1 AND "userId" = $2',
            task.session_id,
            task.user_id,
            dumps(
                {
                    "text": "; ".join(item.question for item in question.questions),
                    "asked_at": question.asked_at.isoformat(),
                    "task_id": task.id,
                    "question_id": question.id,
                }
            ),
            client=tx,
        )
    else:
        await execute_raw_with_schema(
            'UPDATE {schema_prefix}"ChatSession" SET "metadata" = '
            "\"metadata\" - 'pending_question' "
            'WHERE "id" = $1 AND "userId" = $2 '
            "AND (\"metadata\"->'pending_question'->>'question_id' IS NULL "
            "OR \"metadata\"->'pending_question'->>'question_id' = $3)",
            task.session_id,
            task.user_id,
            question.id,
            client=tx,
        )
