from prisma import Prisma

from backend.api.features.tasks.models import WorkspaceTask
from backend.api.features.tasks.question_routing import pending_human_questions
from backend.data.db import execute_raw_with_schema
from backend.util.json import dumps


async def sync_task_question(tx: Prisma, task: WorkspaceTask) -> None:
    if not task.question:
        return
    question = task.question
    pending = pending_human_questions(task)
    if pending and task.status not in ("done", "canceled"):
        if not task.session_id:
            return
        await execute_raw_with_schema(
            'UPDATE {schema_prefix}"ChatSession" SET "metadata" = '
            "COALESCE(\"metadata\", '{{}}'::jsonb) || "
            "jsonb_build_object('pending_question', $3::jsonb) "
            'WHERE "id" = $1 AND "userId" = $2',
            task.session_id,
            task.user_id,
            dumps(
                {
                    "text": "; ".join(item.question for item in pending),
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
            'WHERE "userId" = $2 AND ('
            "\"metadata\"->'pending_question'->>'question_id' = $3 "
            'OR ("id" = $1 AND '
            "\"metadata\"->'pending_question'->>'question_id' IS NULL))",
            task.session_id,
            task.user_id,
            question.id,
            client=tx,
        )
