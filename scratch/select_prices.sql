-- scratch/select_prices.sql
SELECT id, fuel_type, price_per_liter, effective_date FROM market_prices ORDER BY effective_date DESC LIMIT 5;
