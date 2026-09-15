-- Bridge: app sends lowercase fuel_type; constraint requires capitalized.
-- Normalize in a BEFORE trigger so both forms are accepted on the way in,
-- with the canonical capitalized form stored.
CREATE OR REPLACE FUNCTION internal.normalize_tank_fuel_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.fuel_type IS NOT NULL THEN
        NEW.fuel_type := CASE LOWER(TRIM(NEW.fuel_type))
            WHEN 'diesel'    THEN 'Diesel'
            WHEN 'petrol'    THEN 'Petrol'
            WHEN 'gasoline'  THEN 'Petrol'
            WHEN 'kerosene'  THEN 'Kerosene'
            WHEN 'jet fuel'  THEN 'Jet Fuel'
            WHEN 'jet_fuel'  THEN 'Jet Fuel'
            WHEN 'jetfuel'   THEN 'Jet Fuel'
            WHEN 'lpg'       THEN 'LPG'
            ELSE NEW.fuel_type
        END;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_tank_fuel_type ON public.tanks;
CREATE TRIGGER trg_normalize_tank_fuel_type
    BEFORE INSERT OR UPDATE OF fuel_type ON public.tanks
    FOR EACH ROW
    EXECUTE FUNCTION internal.normalize_tank_fuel_type();
