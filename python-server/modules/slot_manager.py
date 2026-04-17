"""
Slot lifecycle management.
Mirrors slotManager.ts exactly.
"""
import uuid
from datetime import datetime


def _generate_id():
    return f"slot_{uuid.uuid4()}"


def create_slot(params):
    """Creates a new OT slot with status 'Created'."""
    return {
        'id': _generate_id(),
        'otType': params['otType'],
        'date': params['date'],
        'program': params['program'],
        'lobby': params.get('lobby', ''),
        'timeWindow': params['timeWindow'],
        'status': 'Created',
        'assignedAgentId': None,
        'assignedAgentName': None,
        'createdAt': datetime.utcnow().isoformat() + 'Z',
        'releasedAt': None,
        'filledAt': None,
        'filledByAgentId': None,
        'filledByAgentName': None,
        'returnedAt': None,
    }


def create_slot_for_agent(params, agent_id, agent_name):
    """Creates a slot pre-assigned to a specific agent."""
    slot = create_slot(params)
    slot['assignedAgentId'] = agent_id
    slot['assignedAgentName'] = agent_name
    return slot


def release_slots(slots, slot_ids):
    """Releases one or more slots. Each must be in 'Created' status."""
    id_set = set(slot_ids)
    result = []
    for slot in slots:
        if slot['id'] not in id_set:
            result.append(slot)
        else:
            if slot['status'] != 'Created':
                raise ValueError(f'Slot cannot be released from "{slot["status"]}" status.')
            new_slot = dict(slot)
            new_slot['status'] = 'Released'
            new_slot['releasedAt'] = datetime.utcnow().isoformat() + 'Z'
            result.append(new_slot)
    return result


def cancel_slot(slots, slot_id):
    """Cancels a slot. Must be in 'Created' or 'Released' status."""
    result = []
    for slot in slots:
        if slot['id'] != slot_id:
            result.append(slot)
        else:
            if slot['status'] not in ('Created', 'Released'):
                raise ValueError(f'Slot cannot be cancelled from "{slot["status"]}" status.')
            new_slot = dict(slot)
            new_slot['status'] = 'Cancelled'
            result.append(new_slot)
    return result


def pickup_slot(slots, slot_id, agent_id, agent_name):
    """Picks up a released slot for an agent."""
    result = []
    for slot in slots:
        if slot['id'] != slot_id:
            result.append(slot)
        else:
            if slot['status'] != 'Released':
                raise ValueError('This slot is no longer available.')
            new_slot = dict(slot)
            new_slot['status'] = 'Filled'
            new_slot['filledAt'] = datetime.utcnow().isoformat() + 'Z'
            new_slot['filledByAgentId'] = agent_id
            new_slot['filledByAgentName'] = agent_name
            result.append(new_slot)
    return result


def return_slot(slots, slot_id):
    """Returns a filled slot back to Released status."""
    result = []
    for slot in slots:
        if slot['id'] != slot_id:
            result.append(slot)
        else:
            if slot['status'] != 'Filled':
                raise ValueError('This slot cannot be returned from its current status.')
            new_slot = dict(slot)
            new_slot['status'] = 'Released'
            new_slot['filledAt'] = None
            new_slot['filledByAgentId'] = None
            new_slot['filledByAgentName'] = None
            new_slot['returnedAt'] = datetime.utcnow().isoformat() + 'Z'
            result.append(new_slot)
    return result


def get_slots_by_status(slots, status):
    return [s for s in slots if s['status'] == status]


def get_slots_by_program(slots, program):
    return [s for s in slots if s['program'] == program]
