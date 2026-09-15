-- scratch/insert_prices.sql
INSERT INTO market_prices (fuel_type, price_per_liter, currency, source, region, effective_date, metadata)
VALUES 
  ('PMS', 214.25, 'KES', 'epra', 'kenya', '2026-05-18', '{"source_detail": "CLI_MANUAL_SYNC", "isOfficial": true}'),
  ('AGO', 232.86, 'KES', 'epra', 'kenya', '2026-05-18', '{"source_detail": "CLI_MANUAL_SYNC", "isOfficial": true}'),
  ('IK', 191.38, 'KES', 'epra', 'kenya', '2026-05-18', '{"source_detail": "CLI_MANUAL_SYNC", "isOfficial": true}')
ON CONFLICT (fuel_type, source, region, effective_date) 
DO UPDATE SET price_per_liter = EXCLUDED.price_per_liter, metadata = EXCLUDED.metadata;
