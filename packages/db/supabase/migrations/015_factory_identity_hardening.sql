-- Challenges must be uniquely identified by the deployed challenge contract.
-- Factory challenge ids are only unique within a factory, not across an entire chain.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS factory_address text;

UPDATE challenges
SET
  contract_address = lower(contract_address),
  factory_address = lower(factory_address),
  poster_address = lower(poster_address)
WHERE
  contract_address <> lower(contract_address)
  OR coalesce(factory_address, '') <> lower(coalesce(factory_address, ''))
  OR poster_address <> lower(poster_address);

CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_contract_unique
  ON challenges(chain_id, contract_address);

CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_factory_identity_unique
  ON challenges(chain_id, factory_address, factory_challenge_id)
  WHERE factory_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_challenges_factory_address
  ON challenges(factory_address);

DROP INDEX IF EXISTS idx_challenges_unique;
