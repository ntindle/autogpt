from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.copilot.gate import references
from backend.copilot.model import ChatSession


@pytest.mark.parametrize("organization_id", [None, "saved-business-org"])
async def test_expert_card_uses_saved_chat_org(organization_id):
    session = ChatSession.new(user_id="owner", dry_run=False)
    session.organization_id = organization_id
    call = references._Call(user_id="owner", session=session, args={})
    experts = MagicMock(get_expert=AsyncMock(return_value=None))
    with patch.object(references, "experts_db", return_value=experts):
        assert await references._expert("other-org-expert", call) is None
    experts.get_expert.assert_awaited_once_with(
        "owner",
        "other-org-expert",
        include_workflows=False,
        organization_id=organization_id,
    )


@pytest.mark.parametrize("organization_id", [None, "saved-business-org"])
async def test_expert_name_card_resolves_roster_in_saved_chat_org(organization_id):
    session = ChatSession.new(user_id="owner", dry_run=False)
    session.organization_id = organization_id
    call = references._Call(user_id="owner", session=session, args={})
    experts = MagicMock(
        get_expert=AsyncMock(return_value=None),
        list_experts=AsyncMock(return_value=[]),
    )
    with patch(
        "backend.copilot.tools.expert_delegation.experts_db", return_value=experts
    ):
        assert await references._expert_or_name("Reviewer", call) is None
    experts.list_experts.assert_awaited_once_with(
        "owner", with_metrics=False, organization_id=organization_id
    )
