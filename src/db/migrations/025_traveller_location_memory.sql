ALTER TABLE traveller_memories DROP CONSTRAINT IF EXISTS traveller_memories_memory_key_check;
ALTER TABLE traveller_memories ADD CONSTRAINT traveller_memories_memory_key_check
  CHECK (memory_key IN ('occasion','companion_name','companion_relationship','preference','dislike',
    'dietary_requirement','allergy','accessibility_need','budget_preference','communication_preference',
    'current_location','trip_destination'));
