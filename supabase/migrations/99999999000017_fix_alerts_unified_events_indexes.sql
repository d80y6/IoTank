


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE SCHEMA IF NOT EXISTS "internal";


ALTER SCHEMA "internal" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."subscription_status" AS ENUM (
    'TRIAL',
    'PROVISIONING',
    'ACTIVE',
    'PAST_DUE',
    'SUSPENDED',
    'CANCELLED'
);


ALTER TYPE "public"."subscription_status" OWNER TO "postgres";


CREATE TYPE "public"."subscription_tier" AS ENUM (
    'BASIC',
    'PRO',
    'ENTERPRISE'
);


ALTER TYPE "public"."subscription_tier" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."audit_trigger_handler"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_station_id UUID;
BEGIN
    -- Resolve station_id from the record
    BEGIN
        v_station_id := COALESCE(NEW.station_id, OLD.station_id);
    EXCEPTION WHEN OTHERS THEN
        v_station_id := NULL;
    END;

    INSERT INTO public.unified_events (
        station_id, 
        event_category, 
        event_type, 
        description, 
        actor_id, 
        actor_email, 
        metadata
    )
    VALUES (
        v_station_id,
        'SYSTEM',
        TG_TABLE_NAME || '_' || TG_OP,
        'Forensic audit: ' || TG_OP || ' detected on ' || TG_TABLE_NAME,
        auth.uid(),
        auth.jwt()->>'email',
        jsonb_build_object(
            'old', internal.redact_pii(to_jsonb(OLD)), 
            'new', internal.redact_pii(to_jsonb(NEW))
        )
    );
    RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "internal"."audit_trigger_handler"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."check_is_admin_internal"("p_uid" "uuid", "p_min_level" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
    v_role TEXT;
    v_active BOOLEAN;
    v_role_order INTEGER;
    v_req_order INTEGER;
BEGIN
    -- 1. Resolve role and status
    SELECT role, is_active INTO v_role, v_active
    FROM public.system_users
    WHERE auth_user_id = p_uid;

    IF NOT FOUND OR NOT v_active THEN RETURN FALSE; END IF;
    IF p_min_level IS NULL THEN RETURN TRUE; END IF;

    -- 2. Evaluate Hierarchy
    v_role_order := CASE v_role
        WHEN 'super_admin'   THEN 1
        WHEN 'admin_helper'  THEN 2
        WHEN 'support_staff' THEN 3
        WHEN 'analyst'       THEN 4
        ELSE 99
    END;

    v_req_order := CASE p_min_level
        WHEN 'super_admin'   THEN 1
        WHEN 'admin_helper'  THEN 2
        WHEN 'support_staff' THEN 3
        WHEN 'analyst'       THEN 4
        ELSE 99
    END;

    RETURN v_role_order <= v_req_order;
END;
$$;


ALTER FUNCTION "internal"."check_is_admin_internal"("p_uid" "uuid", "p_min_level" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."check_sla_breaches"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    ticket_record RECORD;
BEGIN
    FOR ticket_record IN 
        SELECT st.*, fs.station_name 
        FROM public.support_tickets st
        JOIN public.fuel_stations fs ON st.station_id = fs.station_id
        WHERE st.status NOT IN ('resolved', 'closed')
        AND st.created_at < (NOW() - INTERVAL '4 hours')
    LOOP
        -- Check if already notified to avoid spam
        IF NOT EXISTS (
            SELECT 1 FROM public.system_notifications 
            WHERE category = 'sla' 
            AND metadata->>'ticket_id' = ticket_record.id::TEXT 
            AND created_at > (NOW() - INTERVAL '12 hours')
        ) THEN
            INSERT INTO public.system_notifications (
                category,
                priority,
                title,
                message,
                metadata
            ) VALUES (
                'sla',
                'critical',
                'SLA Breach Detected',
                'Ticket #' || SUBSTRING(ticket_record.id::TEXT, 1, 8) || ' for ' || ticket_record.station_name || ' has exceeded the 4-hour response threshold.',
                jsonb_build_object('ticket_id', ticket_record.id)
            );
        END IF;
    END LOOP;
END;
$$;


ALTER FUNCTION "internal"."check_sla_breaches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."check_tank_thresholds"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_client_id UUID;
BEGIN
    -- Only proceed if it's a sensor_readings insert
    SELECT client_id INTO v_client_id FROM tanks WHERE id = NEW.tank_id;
    
    -- Check Low Level: Percentage-based comparison (ambient_volume <= % threshold of capacity)
    BEGIN
        IF NEW.ambient_volume <= (SELECT (low_level_threshold / 100.0) * tank_capacity FROM tanks WHERE id = NEW.tank_id) THEN
            INSERT INTO public.alerts (client_id, tank_id, alert_type, severity, title, message)
            VALUES (
                v_client_id, 
                NEW.tank_id, 
                'low_fuel', 
                'warning', 
                'Low Fuel Level Alert', 
                'Tank has reached low fuel threshold. Consider reordering.'
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Silent fail to prevent sensor readings from being blocked by alert bugs
        NULL;
    END;

    -- Check High Temp
    BEGIN
        IF NEW.temperature >= (SELECT high_temperature_threshold FROM tanks WHERE id = NEW.tank_id) THEN
            INSERT INTO public.alerts (client_id, tank_id, alert_type, severity, title, message)
            VALUES (
                v_client_id, 
                NEW.tank_id, 
                'high_temperature', 
                'critical', 
                'High Temperature Alert', 
                'Tank temperature has exceeded safety threshold!'
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."check_tank_thresholds"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."security_telemetry_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "source" "text" NOT NULL,
    "endpoint" "text",
    "actor_uid" "uuid",
    "actor_email" "text",
    "actor_role" "text",
    "actor_auth_level" integer,
    "station_id" "uuid",
    "scope_key" "text",
    "status_code" integer,
    "reason" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "alert_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "alert_attempts" integer DEFAULT 0 NOT NULL,
    "last_alert_error" "text",
    "alerted_at" timestamp with time zone,
    CONSTRAINT "security_telemetry_events_alert_status_chk" CHECK (("alert_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'sent'::"text", 'failed'::"text", 'not_applicable'::"text"]))),
    CONSTRAINT "security_telemetry_events_severity_chk" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."security_telemetry_events" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."claim_pending_critical_alert_events"("p_limit" integer DEFAULT 20) RETURNS SETOF "public"."security_telemetry_events"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 200';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.security_telemetry_events
    WHERE severity = 'critical'
      AND alert_status IN ('pending', 'failed')
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.security_telemetry_events ste
    SET
      alert_status = 'processing',
      alert_attempts = ste.alert_attempts + 1
    FROM picked
    WHERE ste.id = picked.id
    RETURNING ste.*
  )
  SELECT * FROM updated;
END;
$$;


ALTER FUNCTION "internal"."claim_pending_critical_alert_events"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."complete_critical_alert_event"("p_event_id" "uuid", "p_sent" boolean, "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.security_telemetry_events
  SET
    alert_status = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
    alerted_at = CASE WHEN p_sent THEN NOW() ELSE alerted_at END,
    last_alert_error = CASE WHEN p_sent THEN NULL ELSE LEFT(COALESCE(p_error, 'unknown error'), 1000) END
  WHERE id = p_event_id
    AND severity = 'critical';
END;
$$;


ALTER FUNCTION "internal"."complete_critical_alert_event"("p_event_id" "uuid", "p_sent" boolean, "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."create_event_partition"("p_year_month" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'internal'
    AS $$
DECLARE
    v_table_name TEXT;
    v_start_date TEXT;
    v_end_date TEXT;
BEGIN
    v_table_name := 'unified_events_' || p_year_month;
    v_start_date := replace(p_year_month, '_', '-') || '-01';
    v_end_date := (v_start_date)::DATE + INTERVAL '1 month';

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.unified_events 
         FOR VALUES FROM (%L) TO (%L)',
        v_table_name, v_start_date, v_end_date
    );
    
    -- Auto-enable RLS on the newly created partition to prevent future linter errors
    EXECUTE format(
        'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
        v_table_name
    );
END;
$$;


ALTER FUNCTION "internal"."create_event_partition"("p_year_month" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."handle_data_smoothing"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Use the Vault-stored service role key, not the anon key
    IF current_setting('app.settings.service_role_key', true) IS NOT NULL THEN
        PERFORM net.http_post(
            url     := 'https://suifvborodwergtrbjez.supabase.co/functions/v1/data-smoothing',
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
            ),
            body    := jsonb_build_object('record', to_jsonb(NEW))
        );
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."handle_data_smoothing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (auth_user_id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'viewer'
  )
  ON CONFLICT (email) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id,
    updated_at = NOW();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: Failed to create profile for %. Error: %', NEW.email, SQLERRM;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."handle_user_deletion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    DELETE FROM public.profiles WHERE auth_user_id = OLD.id;
    DELETE FROM public.system_users WHERE auth_user_id = OLD.id;
    RETURN OLD;
END;
$$;


ALTER FUNCTION "internal"."handle_user_deletion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."manage_event_partitions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'internal'
    AS $$
BEGIN
    -- Create partition for next month
    PERFORM internal.create_event_partition(to_char(now() + interval '1 month', 'YYYY_MM'));
    -- Create partition for 2 months out
    PERFORM internal.create_event_partition(to_char(now() + interval '2 month', 'YYYY_MM'));
END;
$$;


ALTER FUNCTION "internal"."manage_event_partitions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."prevent_last_super_admin_removal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  active_super_admins INTEGER;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.role = 'super_admin'
     AND OLD.is_active = TRUE
     AND (NEW.role <> 'super_admin' OR NEW.is_active = FALSE) THEN
    SELECT COUNT(*) INTO active_super_admins
    FROM public.system_users
    WHERE role = 'super_admin' AND is_active = TRUE;

    IF active_super_admins <= 1 THEN
      RAISE EXCEPTION 'Cannot deactivate or demote the last active super_admin.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."prevent_last_super_admin_removal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."prevent_unified_events_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Only allow updating is_resolved flag. Everything else must exactly match.
        IF NEW.id = OLD.id 
           AND NEW.station_id = OLD.station_id
           AND NEW.event_category = OLD.event_category
           AND NEW.event_type = OLD.event_type
           AND NEW.description = OLD.description
           AND NEW.actor_id = OLD.actor_id
           AND NEW.metadata = OLD.metadata
           AND NEW.created_at = OLD.created_at THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'unified_events: Audit log entries are immutable and cannot be modified or deleted.';
END;
$$;


ALTER FUNCTION "internal"."prevent_unified_events_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."process_monthly_invoicing"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    station_record RECORD;
    v_billable_units INTEGER;
    current_mrr DECIMAL(12,2);
    next_invoice_num TEXT;
BEGIN
    FOR station_record IN SELECT station_id, station_name FROM public.fuel_stations LOOP
        -- Simple logic: KES 2,000 per unit (tank)
        v_billable_units := (SELECT COUNT(*) FROM public.tanks WHERE station_id = station_record.station_id);
        current_mrr := v_billable_units * 2000;
        
        next_invoice_num := 'INV-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || SUBSTRING(station_record.station_id::TEXT, 1, 4);
        
        INSERT INTO public.invoices (
            station_id,
            invoice_number,
            billing_period_start,
            billing_period_end,
            amount_due,
            status,
            due_date
        ) VALUES (
            station_record.station_id,
            next_invoice_num,
            (DATE_TRUNC('month', NOW()) - INTERVAL '1 month')::DATE,
            (DATE_TRUNC('month', NOW()) - INTERVAL '1 day')::DATE,
            current_mrr,
            'unpaid',
            (DATE_TRUNC('month', NOW()) + INTERVAL '4 days')::DATE
        ) ON CONFLICT (invoice_number) DO NOTHING;
    END LOOP;
END;
$$;


ALTER FUNCTION "internal"."process_monthly_invoicing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."protect_profile_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Allow the service_role (used by Edge Functions) to bypass these checks
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Ensure station_id exists in NEW record before checking
  -- Replacing client_id check with station_id check for station-centric architecture
  IF public.get_auth_level() > 1 THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      NEW.role := OLD.role;
    END IF;
    
    -- Removed client_id check (deprecated)
    -- We can check station_id instead if we want to protect it, but for now we just fix the crash
    IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
      NEW.auth_user_id := OLD.auth_user_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."protect_profile_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."protect_profile_sensitive_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Bypass for service_role (Edge Functions)
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Use high-level security check to avoid field-level loops
  IF NOT public.is_system_admin('super_admin') THEN
    IF (NEW.role IS DISTINCT FROM OLD.role) THEN
      RAISE EXCEPTION 'Unauthorized: Role escalation is prohibited.';
    END IF;
    -- client_id check removed (legacy)
    IF (NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id) THEN
      RAISE EXCEPTION 'Unauthorized: Identity hijacking is prohibited.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."protect_profile_sensitive_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."purge_edge_rate_limits"("p_older_than_hours" integer DEFAULT 72) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_older_than_hours < 1 OR p_older_than_hours > 8760 THEN
    RAISE EXCEPTION 'p_older_than_hours must be between 1 and 8760';
  END IF;

  DELETE FROM public.edge_rate_limits
  WHERE updated_at < NOW() - make_interval(hours => p_older_than_hours);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "internal"."purge_edge_rate_limits"("p_older_than_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."purge_security_telemetry_events"("p_older_than_days" integer DEFAULT 90) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_older_than_days < 7 OR p_older_than_days > 3650 THEN
    RAISE EXCEPTION 'p_older_than_days must be between 7 and 3650';
  END IF;

  DELETE FROM public.security_telemetry_events
  WHERE created_at < NOW() - make_interval(days => p_older_than_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "internal"."purge_security_telemetry_events"("p_older_than_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."redact_pii"("p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'internal'
    AS $$
BEGIN
    IF p_data IS NULL THEN RETURN NULL; END IF;
    RETURN p_data 
        - 'email' 
        - 'phone' 
        - 'phone_number' 
        - 'password' 
        - 'master_access_password' 
        - 'photo_url'
        - 'display_name'
        - 'full_name';
END;
$$;


ALTER FUNCTION "internal"."redact_pii"("p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."safe_harden_table"("p_table_name" "text", "p_firebase_col" "text" DEFAULT 'firebase_uid'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Only proceed if the table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = p_table_name) THEN
        RETURN;
    END IF;

    -- Add supabase_uid if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = p_table_name AND column_name = 'supabase_uid') THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN supabase_uid UUID REFERENCES auth.users(id)', p_table_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(supabase_uid)', 'idx_' || p_table_name || '_supabase_uid', p_table_name);
    END IF;

    -- Make firebase column nullable if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = p_table_name AND column_name = p_firebase_col) THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', p_table_name, p_firebase_col);
    END IF;
END;
$$;


ALTER FUNCTION "internal"."safe_harden_table"("p_table_name" "text", "p_firebase_col" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."safe_unschedule_job"("p_job_name" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = p_job_name) THEN
        PERFORM cron.unschedule(p_job_name);
    END IF;
END;
$$;


ALTER FUNCTION "internal"."safe_unschedule_job"("p_job_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."stamp_admin_log_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.system_user_id IS NULL THEN
    SELECT id INTO NEW.system_user_id
    FROM public.system_users
    WHERE supabase_uid = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."stamp_admin_log_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."stamp_audit_log_client"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF public.get_auth_level() >= 4 THEN
    NEW.client_id := public.get_user_client_id();
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'audit_logs'
        AND column_name = 'supabase_uid'
    ) THEN
      NEW.supabase_uid := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."stamp_audit_log_client"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."stamp_sender_name"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NEW.sender_role = 'admin' THEN
        NEW.sender_name := (SELECT full_name FROM public.system_users WHERE auth_user_id = NEW.sender_id);
    ELSIF NEW.sender_role = 'client' THEN
        NEW.sender_name := (SELECT full_name FROM public.profiles WHERE auth_user_id = NEW.sender_id);
    ELSE
        NEW.sender_name := 'System AI';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."stamp_sender_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."sync_system_user_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL THEN
    UPDATE public.system_users
    SET auth_user_id = NEW.auth_user_id,
        updated_at = NOW()
    WHERE lower(email) = lower(NEW.email)
      AND auth_user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."sync_system_user_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."update_tank_from_sensor"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_tank_station_id UUID;
BEGIN
    -- [FORENSIC CHECK]: Verify that the tank being updated belongs to the station in the reading
    SELECT station_id INTO v_tank_station_id
    FROM public.tanks
    WHERE id = NEW.tank_id;

    -- If tank doesn't exist or station mismatch, block the entire operation
    IF v_tank_station_id IS NULL OR v_tank_station_id != NEW.station_id THEN
        RAISE EXCEPTION 'Hardware Authorization Failure: Tank ID % does not belong to Station ID %. Cross-station spoofing prevented.', NEW.tank_id, NEW.station_id;
    END IF;

    -- 2. Update the tank state
    UPDATE public.tanks t
    SET current_volume        = NEW.volume,
        current_temperature   = NEW.temperature,
        last_reading_at       = NOW(), 
        updated_at            = NOW()
    WHERE t.id = NEW.tank_id;
  
    RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."update_tank_from_sensor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."update_tank_state"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Use a row lock to prevent race conditions during concurrent readings
    PERFORM 1 FROM public.tanks WHERE id = NEW.tank_id FOR UPDATE;

    UPDATE public.tanks
    SET 
        current_volume = NEW.volume,        -- Updated from ambient_volume
        current_temperature = NEW.temperature,
        last_reading_at = NEW.timestamp,
        updated_at = NOW()
    WHERE id = NEW.tank_id;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."update_tank_state"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."validate_sensor_reading"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_capacity  NUMERIC;
    v_tank_name TEXT;
BEGIN
    -- Volume must be non-negative
    IF NEW.volume < 0 THEN
        RAISE EXCEPTION 'sensor_readings: Volume cannot be negative (got %)', NEW.volume;
    END IF;

    -- Temperature sanity check (-40°C to +80°C covers all industrial fuels)
    IF NEW.temperature IS NOT NULL AND (NEW.temperature < -40 OR NEW.temperature > 80) THEN
        RAISE EXCEPTION 'sensor_readings: Temperature % is outside safe range (-40 to 80°C)', NEW.temperature;
    END IF;

    -- Volume cannot exceed tank capacity
    SELECT tank_capacity, tank_name
    INTO   v_capacity, v_tank_name
    FROM   public.tanks
    WHERE  id = NEW.tank_id;

    IF v_capacity IS NOT NULL AND NEW.volume > v_capacity THEN
        RAISE EXCEPTION 'sensor_readings: Volume % exceeds tank "%" capacity %',
            NEW.volume, v_tank_name, v_capacity;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "internal"."validate_sensor_reading"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_debt_to_client"("p_station_id" "uuid", "p_amount" numeric, "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE public.fuel_stations
    SET current_debt = current_debt + p_amount,
        updated_at = NOW()
    WHERE station_id = p_station_id;

    INSERT INTO public.transactions (
        station_id, transaction_type, amount, description, payment_status
    ) VALUES (
        p_station_id, 'charge', p_amount, p_reason, 'pending'
    );
END;
$$;


ALTER FUNCTION "public"."add_debt_to_client"("p_station_id" "uuid", "p_amount" numeric, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_station_debt"("p_station_id" "uuid", "p_adjustment_amount" numeric, "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$ BEGIN RETURN '{}'::jsonb; END; $$;


ALTER FUNCTION "public"."admin_adjust_station_debt"("p_station_id" "uuid", "p_adjustment_amount" numeric, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_monthly_billing"() RETURNS TABLE("station_id" "uuid", "station_name" "text", "debt_added" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    WITH updated AS (
        UPDATE fuel_stations
        SET 
            current_debt = current_debt + 5000,
            last_billing_date = NOW(),
            next_billing_date = next_billing_date + INTERVAL '30 days',
            sub_status = CASE 
                WHEN sub_status = 'TRIAL' THEN 'ACTIVE'::subscription_status 
                ELSE sub_status 
            END,
            updated_at = NOW()
        WHERE 
            sub_status IN ('TRIAL', 'ACTIVE', 'PAST_DUE')
            AND (
                (sub_status = 'TRIAL' AND NOW() >= trial_ends_at)
                OR (sub_status != 'TRIAL' AND NOW() >= next_billing_date)
            )
        RETURNING fuel_stations.station_id, fuel_stations.station_name
    )
    SELECT u.station_id, u.station_name, 5000::DECIMAL FROM updated u;
END;
$$;


ALTER FUNCTION "public"."apply_monthly_billing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_trigger_handler"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
    v_station_id UUID;
    v_actor_name TEXT;
    v_category TEXT := 'SYSTEM';
    v_should_audit BOOLEAN := TRUE;
    v_description TEXT;
    v_severity TEXT := 'INFO';
BEGIN
    -- Resolve station_id
    v_station_id := COALESCE(NEW.station_id, OLD.station_id);

    -- ── TELEMETRY FILTERING ─────────────────
    IF TG_TABLE_NAME = 'tanks' AND TG_OP = 'UPDATE' THEN
        IF (OLD.* IS NOT DISTINCT FROM NEW.*) THEN 
            v_should_audit := FALSE;
        ELSIF (OLD.current_volume IS DISTINCT FROM NEW.current_volume OR OLD.last_reading_at IS DISTINCT FROM NEW.last_reading_at)
              AND OLD.tank_name = NEW.tank_name AND OLD.tank_capacity = NEW.tank_capacity THEN
            v_should_audit := FALSE; 
        END IF;
    END IF;

    IF NOT v_should_audit THEN RETURN NEW; END IF;

    -- ── CATEGORY ASSIGNMENT ──────────────────
    IF TG_TABLE_NAME IN ('fuel_transactions', 'deliveries') THEN 
        v_category := 'DELIVERY';
    ELSIF TG_TABLE_NAME = 'shift_closures' THEN 
        v_category := 'SHIFT';
    ELSIF TG_TABLE_NAME = 'alerts' THEN 
        v_category := 'SECURITY';
    ELSIF TG_TABLE_NAME = 'billing' THEN 
        v_category := 'FINANCE';
    ELSIF TG_TABLE_NAME IN ('tanks', 'sites') THEN
        v_category := 'INVENTORY';
    END IF;

    -- ── DESCRIPTIVE LOGGING ──────────────────
    IF TG_TABLE_NAME = 'tanks' THEN
        IF TG_OP = 'INSERT' THEN v_description := 'New tank asset initialized: ' || NEW.tank_name;
        ELSIF TG_OP = 'UPDATE' THEN 
            IF OLD.tank_name <> NEW.tank_name THEN
                v_description := 'Tank renamed: ' || OLD.tank_name || ' -> ' || NEW.tank_name;
            ELSE
                v_description := 'Configuration modified for tank: ' || NEW.tank_name;
            END IF;
        ELSIF TG_OP = 'DELETE' THEN v_description := 'Permanent removal of tank asset: ' || OLD.tank_name;
        END IF;
    ELSIF TG_TABLE_NAME = 'sites' THEN
        IF TG_OP = 'INSERT' THEN v_description := 'New facility registered: ' || NEW.site_name;
        ELSIF TG_OP = 'UPDATE' THEN v_description := 'Site metadata updated: ' || NEW.site_name;
        ELSIF TG_OP = 'DELETE' THEN v_description := 'Facility record purged: ' || OLD.site_name;
        END IF;
    ELSIF TG_TABLE_NAME = 'alerts' THEN
        IF TG_OP = 'INSERT' THEN 
            v_description := 'Security alert generated: [' || NEW.severity || '] ' || NEW.title;
        ELSIF TG_OP = 'UPDATE' THEN
            IF NEW.is_resolved AND NOT OLD.is_resolved THEN
                v_description := 'Alert resolved: ' || NEW.title;
            ELSE
                v_description := 'Alert metadata updated: ' || NEW.title;
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'shift_closures' THEN
        IF TG_OP = 'INSERT' THEN
            v_description := 'Shift closure recorded for tank ' || COALESCE((SELECT tank_name FROM tanks WHERE id = NEW.tank_id), 'Unknown');
        ELSE
            v_description := 'Shift record ' || TG_OP || 'ed by operator.';
        END IF;
    ELSIF TG_TABLE_NAME = 'current_station_shifts' THEN
        v_description := 'Station shift status changed to ' || NEW.status;
    ELSE
        v_description := 'Forensic audit: ' || TG_OP || ' on ' || TG_TABLE_NAME;
    END IF;

    -- Attempt to get actor name
    SELECT display_name INTO v_actor_name FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

    -- [INTELLIGENCE]: Map severity from source if available
    IF TG_TABLE_NAME = 'alerts' THEN
        v_severity := UPPER(COALESCE(NEW.severity, 'INFO'));
    ELSIF v_category = 'SECURITY' THEN
        v_severity := 'CRITICAL';
    ELSE
        v_severity := 'INFO';
    END IF;

    INSERT INTO public.unified_events (
        station_id, 
        event_category, 
        event_type, 
        description, 
        actor_id, 
        actor_email, 
        actor_name, 
        metadata,
        severity
    )
    VALUES (
        v_station_id, 
        v_category, 
        TG_TABLE_NAME || '_' || TG_OP,
        v_description,
        auth.uid(), 
        auth.jwt()->>'email', 
        COALESCE(v_actor_name, auth.jwt()->>'email', 'SYSTEM'),
        jsonb_build_object(
            'old', to_jsonb(OLD), 
            'new', to_jsonb(NEW),
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'timestamp', now()
        ),
        v_severity
    );

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_trigger_handler"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_delivery_variance"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.actual_received_volume := NEW.tank_after_volume - NEW.tank_before_volume;
  IF NEW.bol_claimed_volume > 0 THEN
    NEW.variance_percentage := ROUND(
      ((NEW.bol_claimed_volume - NEW.actual_received_volume) / NEW.bol_claimed_volume * 100)::NUMERIC, 2
    );
  END IF;
  NEW.verification_status := CASE
    WHEN ABS(NEW.variance_percentage) <= 1.67 THEN 'verified_ok'
    WHEN NEW.variance_percentage > 1.67       THEN 'disputed_shortage'
    ELSE 'disputed_overage'
  END;
  NEW.is_accepted := ABS(NEW.variance_percentage) <= 1.67;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calculate_delivery_variance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_standard_volume"("ambient_volume" numeric, "current_temp" numeric, "fuel_type" "text") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  thermal_expansion_coef DECIMAL;
  standard_temp DECIMAL := 15.5; -- Standard reference temperature
  standard_volume DECIMAL;
BEGIN
  -- Select expansion coefficient based on product (Case-Insensitive)
  thermal_expansion_coef := CASE LOWER(fuel_type)
    WHEN 'diesel' THEN 0.00085
    WHEN 'petrol' THEN 0.00120
    WHEN 'kerosene' THEN 0.00095
    WHEN 'jet fuel' THEN 0.00095 -- Typical for Jet A-1
    ELSE 0.00100
  END;

  -- Correction Formula: V_std = V_amb / (1 + beta * (T - T_ref))
  standard_volume := ambient_volume / (1 + thermal_expansion_coef * (current_temp - standard_temp));
  
  RETURN ROUND(standard_volume, 2);
END;
$$;


ALTER FUNCTION "public"."calculate_standard_volume"("ambient_volume" numeric, "current_temp" numeric, "fuel_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_auth_attempt"("p_email" "text") RETURNS TABLE("allowed" boolean, "remaining_attempts" integer, "reset_time" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_window_start TIMESTAMPTZ := NOW() - INTERVAL '15 minutes';
    v_failed_count INTEGER := 0;
    v_first_failed TIMESTAMPTZ;
BEGIN
    p_email := LOWER(TRIM(p_email));

    SELECT COUNT(*), MIN(attempted_at)
    INTO v_failed_count, v_first_failed
    FROM public.auth_attempts
    WHERE email = p_email
      AND attempted_at > v_window_start
      AND is_success = FALSE;

    IF v_failed_count >= 5 THEN
        RETURN QUERY SELECT FALSE, 0, v_first_failed + INTERVAL '15 minutes';
    ELSE
        RETURN QUERY SELECT TRUE, 5 - v_failed_count, COALESCE(v_first_failed + INTERVAL '15 minutes', NOW() + INTERVAL '15 minutes');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT TRUE, 5, NOW() + INTERVAL '15 minutes';
END;
$$;


ALTER FUNCTION "public"."check_auth_attempt"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_index_exists"("p_index_name" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = p_index_name
    );
END;
$$;


ALTER FUNCTION "public"."check_index_exists"("p_index_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_is_staff"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.system_users
    WHERE auth_user_id = auth.uid()
    AND is_active = TRUE
  );
END;
$$;


ALTER FUNCTION "public"."check_is_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_is_super_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.system_users
    WHERE auth_user_id = auth.uid()
    AND role = 'super_admin'
    AND is_active = TRUE
  );
END;
$$;


ALTER FUNCTION "public"."check_is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_my_identity"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_uid UUID;
  v_auth_user JSONB;
  v_profile JSONB;
  v_system_user JSONB;
BEGIN
  v_uid := auth.uid();
  
  SELECT jsonb_build_object('id', id, 'email', email) INTO v_auth_user FROM auth.users WHERE id = v_uid;
  SELECT to_jsonb(p) INTO v_profile FROM public.profiles p WHERE auth_user_id = v_uid;
  SELECT to_jsonb(su) INTO v_system_user FROM public.system_users su WHERE auth_user_id = v_uid AND is_active = TRUE;

  RETURN jsonb_build_object(
    'timestamp', now(),
    'auth_uid', v_uid,
    'auth_user', v_auth_user,
    'profile', v_profile,
    'system_user', v_system_user,
    'bundle', (SELECT public.get_user_bundle_v2())
  );
END;
$$;


ALTER FUNCTION "public"."check_my_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_sensor_station_lock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- If the sensor_id is already used in a different station, block the insert/update
    IF EXISTS (
        SELECT 1 FROM public.tanks 
        WHERE sensor_id = NEW.sensor_id 
        AND station_id != NEW.station_id
    ) THEN
        RAISE EXCEPTION 'Hardware Violation: ESP ID % is already registered and locked to another station. Please contact support to transfer hardware.', NEW.sensor_id;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_sensor_station_lock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_station_active"("p_station_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM fuel_stations 
        WHERE station_id = p_station_id 
        AND sub_status != 'SUSPENDED'
    );
END;
$$;


ALTER FUNCTION "public"."check_station_active"("p_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_events"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    DELETE FROM public.unified_events WHERE created_at < NOW() - INTERVAL '1 year';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_events"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_rss_cache"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  DELETE FROM public.rss_cache 
  WHERE cached_at < NOW() - INTERVAL '24 hours';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_rss_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_edge_rate_limit"("p_scope_key" "text", "p_endpoint" "text", "p_window_seconds" integer DEFAULT 60, "p_max_requests" integer DEFAULT 20) RETURNS TABLE("allowed" boolean, "remaining" integer, "reset_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_window_start TIMESTAMPTZ;
  v_request_count INTEGER;
  v_is_admin BOOLEAN;
BEGIN
  -- Validate inputs
  IF p_scope_key IS NULL OR btrim(p_scope_key) = '' THEN
    RAISE EXCEPTION 'consume_edge_rate_limit: scope_key is required';
  END IF;

  -- BREAD-CRUMB: Security Check
  -- If not service_role (null v_uid during certain internal flows) and not system admin, 
  -- enforce that the scope_key MUST contain the user's ID or station_id.
  IF v_uid IS NOT NULL THEN
    -- Check if user is system admin
    SELECT EXISTS (
      SELECT 1 FROM public.system_users 
      WHERE auth_user_id = v_uid AND is_active = TRUE
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
      -- Basic check: The scope key must contain the user's UID to prevent cross-user exhaustion
      IF p_scope_key NOT LIKE '%' || v_uid::TEXT || '%' THEN
        RAISE EXCEPTION 'Unauthorized: cannot consume rate limits for another entity.';
      END IF;
    END IF;
  END IF;

  IF p_window_seconds < 1 OR p_window_seconds > 3600 THEN
    RAISE EXCEPTION 'consume_edge_rate_limit: window_seconds must be between 1 and 3600';
  END IF;

  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  WITH consumed AS (
    INSERT INTO public.edge_rate_limits (
      scope_key,
      endpoint,
      window_starts_at,
      request_count
    )
    VALUES (
      p_scope_key,
      p_endpoint,
      v_window_start,
      1
    )
    ON CONFLICT (scope_key, endpoint, window_starts_at)
    DO UPDATE SET
      request_count = public.edge_rate_limits.request_count + 1,
      updated_at = NOW()
    WHERE public.edge_rate_limits.request_count < p_max_requests
    RETURNING request_count
  )
  SELECT request_count INTO v_request_count FROM consumed;

  IF v_request_count IS NOT NULL THEN
    RETURN QUERY
    SELECT
      TRUE AS allowed,
      GREATEST(p_max_requests - v_request_count, 0) AS remaining,
      v_window_start + make_interval(secs => p_window_seconds) AS reset_at;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    FALSE AS allowed,
    0 AS remaining,
    v_window_start + make_interval(secs => p_window_seconds) AS reset_at;
END;
$$;


ALTER FUNCTION "public"."consume_edge_rate_limit"("p_scope_key" "text", "p_endpoint" "text", "p_window_seconds" integer, "p_max_requests" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_auth_uid_text"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT auth.uid()::text;
$$;


ALTER FUNCTION "public"."current_auth_uid_text"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_auth_uid_text"() IS 'Returns auth.uid() as text. Preferred over legacy firebase_uid() alias.';



CREATE OR REPLACE FUNCTION "public"."delete_user_safely"("target_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    -- 1. Ensure caller is a Super Admin
    IF NOT EXISTS (
        SELECT 1 FROM public.system_users 
        WHERE auth_user_id = auth.uid() AND role = 'super_admin' AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Permission Denied: Only Super Admins can execute safe deletions.';
    END IF;

    -- 2. Nullify references in tables that block deletion (RESTRICT / NO ACTION)
    -- Unified Events (Audit Log) - Keep the log, remove the strict reference
    UPDATE public.unified_events SET actor_id = NULL WHERE actor_id = target_user_id;
    
    -- Support Tickets / Messages
    UPDATE public.ticket_messages SET sender_id = NULL WHERE sender_id = target_user_id;
    UPDATE public.system_notifications SET target_admin_id = NULL WHERE target_admin_id = target_user_id;
    
    -- Loss Reviews
    UPDATE public.loss_reviews SET reviewed_by = NULL WHERE reviewed_by = target_user_id;

    -- 3. Delete from public schema profiles (if not already CASCADE)
    DELETE FROM public.profiles WHERE auth_user_id = target_user_id;
    DELETE FROM public.system_users WHERE auth_user_id = target_user_id;

    -- 4. Finally, delete from auth.users
    DELETE FROM auth.users WHERE id = target_user_id;

    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to safely delete user: %', SQLERRM;
END;
$$;


ALTER FUNCTION "public"."delete_user_safely"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detect_theft_anomaly"("p_tank_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_last_vol DECIMAL;
    v_curr_vol DECIMAL;
BEGIN
    SELECT current_volume INTO v_curr_vol FROM public.tanks WHERE id = p_tank_id;
    
    SELECT volume INTO v_last_vol -- FIXED: ambient_volume -> volume
    FROM public.sensor_readings 
    WHERE tank_id = p_tank_id 
    ORDER BY timestamp DESC 
    OFFSET 1 LIMIT 1;
    
    IF v_last_vol IS NOT NULL AND v_last_vol - v_curr_vol > 50 THEN 
        RETURN TRUE;
    END IF;
    RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."detect_theft_anomaly"("p_tank_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."disable_security_pin"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    UPDATE public.profiles
    SET 
        security_pin_hash = NULL,
        security_pin_enabled = FALSE,
        last_pin_change_at = NOW()
    WHERE auth_user_id = auth.uid();
    
    -- Also update system_users if applicable
    UPDATE public.system_users
    SET security_pin_enabled = FALSE
    WHERE auth_user_id = auth.uid();
END;
$$;


ALTER FUNCTION "public"."disable_security_pin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."emergency_set_station_name"("p_name" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
    v_station_id UUID;
    v_user_email TEXT;
    v_existing_name TEXT;
BEGIN
    -- 1. Identify User Context
    SELECT station_id, email INTO v_station_id, v_user_email 
    FROM public.profiles 
    WHERE auth_user_id = auth.uid();
    
    IF v_station_id IS NULL THEN
        RAISE EXCEPTION 'Identity mismatch: User is not associated with any station ID.';
    END IF;

    -- 2. Check for Immutability Requirement
    -- Once a station has a name (that isn't the pending placeholder), only Super Admins can change it.
    SELECT station_name INTO v_existing_name 
    FROM public.fuel_stations 
    WHERE station_id = v_station_id;

    IF v_existing_name IS NOT NULL AND v_existing_name != 'Organization Setup Pending' THEN
        -- Check if current user is a super admin
        IF NOT EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = auth.uid() AND role = 'super_admin') THEN
            RAISE EXCEPTION 'Security Policy: Station names are immutable once registered. Contact System Governance for changes.';
        END IF;
    END IF;

    -- 3. Provision or Update
    INSERT INTO public.fuel_stations (
        station_id, 
        station_name, 
        owner_id, 
        email, 
        account_status,
        created_at
    )
    VALUES (
        v_station_id, 
        p_name, 
        auth.uid(), 
        COALESCE(v_user_email, 'pending@iotank.com'), 
        'active',
        NOW()
    )
    ON CONFLICT (station_id) DO UPDATE 
    SET station_name = EXCLUDED.station_name,
        owner_id = COALESCE(fuel_stations.owner_id, EXCLUDED.owner_id),
        email = COALESCE(fuel_stations.email, EXCLUDED.email);

    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."emergency_set_station_name"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_billing_suspensions"() RETURNS TABLE("station_id" "uuid", "station_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    WITH suspended AS (
        UPDATE fuel_stations
        SET 
            sub_status = 'SUSPENDED'::subscription_status,
            account_status = 'SUSPENDED',
            suspension_reason = 'Unpaid debt exceeding 5-day grace period.',
            updated_at = NOW()
        WHERE 
            sub_status = 'ACTIVE'
            AND current_debt > 0
            -- If bill was generated > 5 days ago and still unpaid
            AND NOW() >= (last_billing_date + INTERVAL '5 days')
        RETURNING fuel_stations.station_id, fuel_stations.station_name
    )
    SELECT s.station_id, s.station_name FROM suspended s;
END;
$$;


ALTER FUNCTION "public"."enforce_billing_suspensions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_user_profile_exists"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    INSERT INTO public.profiles (auth_user_id, email, display_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        'viewer'
    )
    ON CONFLICT (auth_user_id) DO NOTHING;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_user_profile_exists"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."firebase_uid"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  -- Modern shim: returns the Supabase Auth UID (UUID) cast to TEXT
  -- to maintain compatibility with legacy STRING-based identity logic.
  SELECT auth.uid()::text;
$$;


ALTER FUNCTION "public"."firebase_uid"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forensic_update_market_price"("p_fuel_type" "text", "p_new_price" numeric, "p_effective_date" timestamp with time zone, "p_source_url" "text" DEFAULT NULL::"text", "p_is_official" boolean DEFAULT false, "p_signal_id" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_old_price NUMERIC;
    v_price_variance NUMERIC;
    v_station_record RECORD;
    v_final_signal_id TEXT := COALESCE(
        p_signal_id,
        'sig-' || md5(p_fuel_type || p_effective_date::TEXT)
    );
BEGIN
    -- Insert/update market price
    INSERT INTO public.market_prices (
        fuel_type, price_per_liter, effective_date, source, region, metadata
    ) VALUES (
        p_fuel_type,
        p_new_price,
        p_effective_date::DATE,
        CASE WHEN p_is_official THEN 'epra' ELSE 'manual' END,
        'kenya',
        jsonb_build_object('source_url', p_source_url, 'is_official', p_is_official, 'signal_id', v_final_signal_id)
    )
    ON CONFLICT (fuel_type, source, region, effective_date)
    DO UPDATE SET
        price_per_liter = EXCLUDED.price_per_liter,
        metadata = public.market_prices.metadata || EXCLUDED.metadata;

    -- Process action queue for all stations if official
    IF p_is_official THEN
        FOR v_station_record IN
            SELECT station_id, station_name FROM public.fuel_stations
        LOOP
            SELECT price_per_liter INTO v_old_price
            FROM public.market_prices
            WHERE fuel_type = p_fuel_type
              AND source = 'epra'
              AND effective_date < p_effective_date::DATE
            ORDER BY effective_date DESC LIMIT 1;

            v_price_variance := p_new_price - COALESCE(v_old_price, p_new_price);

            IF v_price_variance != 0 THEN
                IF NOT EXISTS (
                    SELECT 1 FROM public.market_action_queue
                    WHERE station_id = v_station_record.station_id
                      AND fuel_type = p_fuel_type
                      AND effective_date = p_effective_date::DATE
                ) THEN
                    INSERT INTO public.market_action_queue (
                        station_id, fuel_type, old_price, new_price,
                        effective_date, action_type, status, metadata
                    ) VALUES (
                        v_station_record.station_id,
                        p_fuel_type,
                        v_old_price,
                        p_new_price,
                        p_effective_date::DATE,
                        'price_adjustment',
                        'pending',
                        jsonb_build_object(
                            'variance',      v_price_variance,
                            'source_url',    p_source_url,
                            'station_name',  v_station_record.station_name,
                            'signal_id',     v_final_signal_id
                        )
                    );
                END IF;
            END IF;
        END LOOP;

        -- Insert market signal
        INSERT INTO public.market_signals (
            id, type, source, source_type, title, summary,
            relevance_score, confidence_score,
            timestamp,
            external_url
        ) VALUES (
            v_final_signal_id,
            'regulatory', 'EPRA', 'Regulatory',
            'Official Price Adjustment: ' || p_fuel_type,
            'EPRA has officially updated the retail price for ' || p_fuel_type ||
            ' to KES ' || p_new_price || '. Effective immediately.',
            1.0, 1.0,
            extract(epoch from now())::bigint * 1000,
            p_source_url
        ) ON CONFLICT (id) DO NOTHING;
    END IF;
END;
$$;


ALTER FUNCTION "public"."forensic_update_market_price"("p_fuel_type" "text", "p_new_price" numeric, "p_effective_date" timestamp with time zone, "p_source_url" "text", "p_is_official" boolean, "p_signal_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_dashboard_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_uid UUID;
  c_users INT := 0;
  c_tanks INT := 0;
  c_stations INT := 0;
  c_operators INT := 0;
  c_online_devs INT := 0;
  c_open_tickets INT := 0;
  c_urgent_tickets INT := 0;
  c_pending_reqs INT := 0;
  c_pending_adjs INT := 0;
  v_mrr DECIMAL := 0;
  v_debt DECIMAL := 0;
  v_recent_activity JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  
  -- Auth Check: Must be super_admin or admin_helper
  IF NOT internal.check_is_admin_internal(v_uid, 'admin_helper') THEN
     RAISE EXCEPTION 'Unauthorized: Administrative access required.';
  END IF;

  -- 1. General Metrics
  SELECT COUNT(*) INTO c_users FROM public.profiles;
  SELECT COUNT(*) INTO c_tanks FROM public.tanks;
  SELECT COUNT(*) INTO c_stations FROM public.fuel_stations;
  SELECT COUNT(*) INTO c_operators FROM public.system_users WHERE is_active = TRUE;
  
  -- 2. Online Devices Check
  -- Prefer telemetry_history, fallback to sensor_readings
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'telemetry_history' AND column_name = 'device_id') THEN
     SELECT COUNT(DISTINCT device_id) INTO c_online_devs 
     FROM public.telemetry_history 
     WHERE created_at > NOW() - INTERVAL '15 minutes';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sensor_readings' AND column_name = 'tank_id') THEN
     SELECT COUNT(DISTINCT tank_id) INTO c_online_devs 
     FROM public.sensor_readings 
     WHERE captured_at > NOW() - INTERVAL '15 minutes';
  END IF;

  -- 3. Financial Metrics
  SELECT COALESCE(SUM(current_debt), 0) INTO v_debt FROM public.fuel_stations;
  SELECT COALESCE(SUM(amount), 0) INTO v_mrr 
  FROM public.transactions 
  WHERE transaction_type IN ('charge', 'usage_charge') 
    AND payment_status = 'completed' 
    AND created_at >= DATE_TRUNC('month', NOW());

  -- 4. Support Metrics
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_tickets') THEN
     EXECUTE 'SELECT COUNT(*) FROM public.support_tickets WHERE status IN (''open'', ''in_progress'')' INTO c_open_tickets;
     EXECUTE 'SELECT COUNT(*) FROM public.support_tickets WHERE priority = ''urgent'' AND status IN (''open'', ''in_progress'')' INTO c_urgent_tickets;
  END IF;

  SELECT COUNT(*) INTO c_pending_reqs FROM public.pending_registrations WHERE status = 'pending';
  
  -- 5. Recent Activity
  -- Use audit_logs instead of admin_logs
  BEGIN
    SELECT jsonb_agg(act) INTO v_recent_activity FROM (
      (SELECT 'system' as type, action as text, created_at, id::text 
       FROM public.audit_logs 
       ORDER BY created_at DESC LIMIT 10)
      UNION ALL
      (SELECT 'registration' as type, 'New client: ' || station_name as text, created_at, id::text 
       FROM public.pending_registrations 
       WHERE status = 'pending' 
       ORDER BY created_at DESC LIMIT 5)
      ORDER BY created_at DESC
      LIMIT 15
    ) act;
  EXCEPTION WHEN OTHERS THEN
    v_recent_activity := '[]'::jsonb;
  END;

  -- 6. Compile Results
  v_result := jsonb_build_object(
    'health', jsonb_build_object(
       'totalUsers', c_users, 'totalTanks', c_tanks, 'totalStations', c_stations, 'totalOperators', c_operators,
       'uptime', '99.99%', 'dbSize', (SELECT pg_size_pretty(pg_database_size(current_database()))),
       'espDevices', jsonb_build_object('online', c_online_devs, 'total', c_tanks),
       'apiStatus', jsonb_build_object('supabase', 'green', 'twilio', 'green')
    ),
    'financial', jsonb_build_object('mrr', v_mrr, 'arr', v_mrr * 12, 'outstandingDebt', v_debt),
    'support', jsonb_build_object('openTickets', c_open_tickets, 'urgentTickets', c_urgent_tickets, 'pendingRequests', c_pending_reqs, 'pendingAdjustments', c_pending_adjs),
    'recentActivity', COALESCE(v_recent_activity, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_admin_dashboard_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_risk_matrix"() RETURNS TABLE("actor_uid" "uuid", "actor_email" "text", "high_risk_actions" bigint, "security_alerts" bigint, "risk_score" double precision)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.auth_user_id as actor_uid,
        u.email as actor_email,
        COUNT(e.id) FILTER (WHERE e.severity = 'CRITICAL') as high_risk_actions,
        COUNT(e.id) FILTER (WHERE e.event_category = 'SECURITY') as security_alerts,
        (COUNT(e.id) FILTER (WHERE e.severity = 'CRITICAL') * 10 + 
         COUNT(e.id) FILTER (WHERE e.event_category = 'SECURITY') * 5)::FLOAT as risk_score
    FROM public.system_users u
    LEFT JOIN public.unified_events e ON e.actor_id = u.auth_user_id
    GROUP BY u.auth_user_id, u.email;
END;
$$;


ALTER FUNCTION "public"."get_admin_risk_matrix"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_auth_level"() RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  n_uid UUID := auth.uid();
  sys_role TEXT;
  prof_role TEXT;
BEGIN
  -- 1. Check system_users
  SELECT role INTO sys_role 
  FROM system_users 
  WHERE auth_user_id = n_uid 
  AND is_active = TRUE
  LIMIT 1;
  
  IF sys_role IS NOT NULL THEN
    CASE sys_role
      WHEN 'super_admin' THEN RETURN 1;
      WHEN 'admin_helper' THEN RETURN 2;
      WHEN 'support_staff' THEN RETURN 3;
      WHEN 'analyst' THEN RETURN 4;
      ELSE RETURN 99;
    END CASE;
  END IF;

  -- 2. Check profiles
  SELECT role INTO prof_role 
  FROM profiles 
  WHERE auth_user_id = n_uid
  LIMIT 1;
  
  IF prof_role IS NOT NULL THEN
    CASE prof_role
      WHEN 'owner' THEN RETURN 5;
      WHEN 'admin' THEN RETURN 5;
      WHEN 'supervisor' THEN RETURN 6;
      WHEN 'operator' THEN RETURN 7;
      WHEN 'viewer' THEN RETURN 8;
      ELSE RETURN 99;
    END CASE;
  END IF;

  RETURN 99;
END;
$$;


ALTER FUNCTION "public"."get_auth_level"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_auth_level"() IS 'Returns the auth level of the user (1-4 for System Admins, 5+ for Client Workforce). Level 6 now specifically includes both Admin and Supervisor roles.';



CREATE OR REPLACE FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'auth', 'public'
    AS $$
BEGIN
  RETURN (SELECT id FROM auth.users WHERE email = p_email LIMIT 1);
END;
$$;


ALTER FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") IS 'Returns user ID for a given email from auth.users. Requires service role or security definer.';



CREATE OR REPLACE FUNCTION "public"."get_business_kpis"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid UUID;
  c_new_clients INT := 0;
  c_prev_new_clients INT := 0;
  c_total_active INT := 0;
  v_mrr DECIMAL := 0;
  v_prev_mrr DECIMAL := 0;
  v_mrr_growth DECIMAL := 0;
  v_arr DECIMAL := 0;
  v_arpu DECIMAL := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  
  -- Auth check
  IF NOT EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = v_uid AND is_active = TRUE) THEN
     IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE auth_user_id = v_uid AND (role = 'super_admin' OR role = 'admin')) THEN
        RAISE EXCEPTION 'Unauthorized';
     END IF;
  END IF;

  -- New Clients this month
  SELECT COUNT(*) INTO c_new_clients 
  FROM public.fuel_stations 
  WHERE created_at >= DATE_TRUNC('month', NOW());

  -- New Clients last month
  SELECT COUNT(*) INTO c_prev_new_clients 
  FROM public.fuel_stations 
  WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
    AND created_at < DATE_TRUNC('month', NOW());

  -- Total Active
  SELECT COUNT(*) INTO c_total_active FROM public.fuel_stations WHERE account_status = 'active';

  -- MRR Calculation
  SELECT COALESCE(SUM(amount), 0) INTO v_mrr 
  FROM public.transactions 
  WHERE transaction_type IN ('charge', 'usage_charge') 
    AND payment_status = 'completed'
    AND created_at >= DATE_TRUNC('month', NOW());

  SELECT COALESCE(SUM(amount), 0) INTO v_prev_mrr 
  FROM public.transactions 
  WHERE transaction_type IN ('charge', 'usage_charge') 
    AND payment_status = 'completed'
    AND created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
    AND created_at < DATE_TRUNC('month', NOW());

  IF v_prev_mrr > 0 THEN
     v_mrr_growth := ((v_mrr - v_prev_mrr) / v_prev_mrr * 100);
  ELSE
     v_mrr_growth := 0;
  END IF;

  v_arr := v_mrr * 12;
  
  IF c_total_active > 0 THEN
     v_arpu := v_mrr / c_total_active;
  ELSE
     v_arpu := 0;
  END IF;

  RETURN jsonb_build_object(
    'newClients', jsonb_build_object(
      'count', c_new_clients,
      'growth', CASE WHEN c_prev_new_clients > 0 THEN ((c_new_clients - c_prev_new_clients)::DECIMAL / c_prev_new_clients * 100) ELSE 0 END
    ),
    'totalActive', c_total_active,
    'churnRate', 1.2, -- Placeholder until churn logic is defined
    'cac', 4200,      -- Placeholder for Customer Acquisition Cost
    'clv', 85000,     -- Placeholder for Customer Lifetime Value
    'mrrGrowth', v_mrr_growth,
    'arr', v_arr,
    'arpu', v_arpu,
    'uptime', 99.98,
    'apiSuccess', 99.99
  );
END;
$$;


ALTER FUNCTION "public"."get_business_kpis"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_business_kpis_v2"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_rate_limit_ok BOOLEAN;
BEGIN
    -- Correctly handle TABLE return type from consume_edge_rate_limit
    SELECT allowed INTO v_rate_limit_ok 
    FROM public.consume_edge_rate_limit(
        (SELECT auth.uid())::text,
        'get_business_kpis',
        60,
        10
    );

    IF NOT v_rate_limit_ok THEN
        RAISE EXCEPTION 'Rate limit exceeded for business analytics. Please wait a minute.';
    END IF;

    RETURN public.get_business_kpis();
END;
$$;


ALTER FUNCTION "public"."get_business_kpis_v2"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_station_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_station_id UUID;
BEGIN
  SELECT station_id INTO v_station_id
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
  RETURN v_station_id;
END;
$$;


ALTER FUNCTION "public"."get_my_station_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_station_dashboard_summary"("p_station_id" "uuid") RETURNS json
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE v_summary JSON;
BEGIN
  SELECT json_build_object(
    'station', (
      SELECT json_build_object(
        'current_debt', fs.current_debt,
        'total_paid', fs.total_paid,
        'account_status', fs.account_status,
        'next_billing_date', fs.next_billing_date
      ) FROM public.fuel_stations fs WHERE fs.station_id = p_station_id
    ),
    'tanks', (
      SELECT json_agg(
        json_build_object(
          'id', t.id, 'name', t.tank_name, 'fuel_type', t.fuel_type,
          'current_volume', t.current_volume, 'capacity', t.tank_capacity,
          'fill_percentage', ROUND((t.current_volume / NULLIF(t.tank_capacity, 0) * 100)::NUMERIC, 2),
          'temperature', t.current_temperature, 'status', t.status
        )
      ) FROM public.tanks t WHERE t.station_id = p_station_id AND t.status = 'active'
    ),
    'unread_alerts', (
      SELECT COUNT(*) FROM public.alerts a
      WHERE a.station_id = p_station_id AND a.is_read = FALSE
    ),
    'critical_alerts', (
      SELECT COUNT(*) FROM public.alerts a
      WHERE a.station_id = p_station_id AND a.is_read = FALSE AND a.severity = 'critical'
    )
  ) INTO v_summary;
  RETURN v_summary;
END;
$$;


ALTER FUNCTION "public"."get_station_dashboard_summary"("p_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_station_id_from_auth"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    RETURN (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1);
END;
$$;


ALTER FUNCTION "public"."get_station_id_from_auth"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_supplier_reliability_score"("p_supplier_name" "text") RETURNS json
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE v_score JSON;
BEGIN
  SELECT json_build_object(
    'supplier_name', p_supplier_name,
    'total_deliveries', COUNT(*),
    'verified_ok', COUNT(*) FILTER (WHERE d.verification_status = 'verified_ok'),
    'disputed_shortages', COUNT(*) FILTER (WHERE d.verification_status = 'disputed_shortage'),
    'avg_variance_percentage', ROUND(AVG(d.variance_percentage)::NUMERIC, 2),
    'reliability_score', ROUND((
      COUNT(*) FILTER (WHERE d.verification_status = 'verified_ok')::DECIMAL
      / NULLIF(COUNT(*), 0) * 100
    )::NUMERIC, 2)
  ) INTO v_score
  FROM public.deliveries d
  WHERE d.supplier_name = p_supplier_name
    AND d.created_at >= NOW() - INTERVAL '12 months';
  RETURN v_score;
END;
$$;


ALTER FUNCTION "public"."get_supplier_reliability_score"("p_supplier_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tank_analytics_30d"("p_station_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- 1. Authorization Check: Ensure the caller belongs to the station
    IF NOT (
        EXISTS (SELECT 1 FROM public.profiles WHERE auth_user_id = auth.uid() AND station_id = p_station_id)
        OR (SELECT (raw_user_meta_data->>'is_admin')::boolean FROM auth.users WHERE id = auth.uid()) = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: User does not have access to this station analytics';
    END IF;

    -- 2. Direct Return to avoid VARIABLE/RELATION ambiguity (v_result removed)
    RETURN (
        WITH daily_stats AS (
            SELECT 
                t.tank_name,
                t.fuel_type,
                COALESCE(SUM(ft.amount), 0) as total_volume,
                COALESCE(AVG(ft.amount), 0) as avg_daily,
                COALESCE(jsonb_agg(jsonb_build_object(
                    'date', ft.timestamp,
                    'volume', ft.amount
                ) ORDER BY ft.timestamp ASC) FILTER (WHERE ft.id IS NOT NULL), '[]'::jsonb) as trend_data
            FROM tanks t
            LEFT JOIN fuel_transactions ft ON t.id = ft.tank_id
            WHERE t.station_id = p_station_id 
              AND (ft.timestamp > (now() - interval '30 days') OR ft.timestamp IS NULL)
            GROUP BY t.id, t.tank_name, t.fuel_type
        )
        SELECT jsonb_build_object(
            'timestamp', now(),
            'station_id', p_station_id,
            'summary', COALESCE(jsonb_agg(s), '[]'::jsonb)
        )
        FROM daily_stats s
    );
END;
$$;


ALTER FUNCTION "public"."get_tank_analytics_30d"("p_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_audit_logs"("p_station_id" "uuid", "p_limit" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'category', event_category,
        'type', event_type,
        'description', description,
        'actor', actor_email,
        'time', created_at
    ))
    FROM (
        SELECT id, event_category, event_type, description, actor_email, created_at
        FROM unified_events
        WHERE station_id = p_station_id
        ORDER BY created_at DESC
        LIMIT p_limit
    ) sub
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;


ALTER FUNCTION "public"."get_tankiq_audit_logs"("p_station_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_consumption_stats"("p_station_id" "uuid", "p_days" integer DEFAULT 7) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'period_days', p_days,
        'summary', (
            SELECT jsonb_agg(jsonb_build_object(
                'tank_name', tank_name,
                'total_burn', total_burn,
                'avg_daily_burn', ROUND((total_burn / p_days)::NUMERIC, 2)
            ))
            FROM (
                SELECT t.tank_name, SUM(s.volume_sold_liters) as total_burn
                FROM tanks t
                JOIN shift_closures s ON t.id = s.tank_id
                WHERE t.station_id = p_station_id 
                  AND s.closed_at > (now() - (p_days || ' days')::INTERVAL)
                GROUP BY t.id, t.tank_name
            ) sub
        )
    ) INTO result;
    
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_tankiq_consumption_stats"("p_station_id" "uuid", "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_delivery_logs"("p_station_id" "uuid", "p_limit" integer DEFAULT 5) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_agg(jsonb_build_object(
        'tank_name', sub.tank_name,
        'volume',    sub.actual_received_volume,
        'date',      sub.delivery_date,
        'supplier',  sub.supplier_name
    ))
    INTO result
    FROM (
        SELECT
            t.tank_name,
            d.actual_received_volume,
            d.delivery_date,
            d.supplier_name
        FROM deliveries d
        JOIN tanks t ON d.tank_id = t.id
        WHERE d.station_id = p_station_id
        ORDER BY d.delivery_date DESC
        LIMIT p_limit
    ) sub;

    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;


ALTER FUNCTION "public"."get_tankiq_delivery_logs"("p_station_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_financial_status"("p_station_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_build_object(
        'current_debt', fs.current_debt,
        'total_paid', fs.total_paid,
        'account_status', fs.status,
        'subscription_tier', fs.tier,
        'recent_invoices', (
            SELECT jsonb_agg(jsonb_build_object(
                'invoice_number', i.invoice_number,
                'amount', i.amount_due,
                'status', i.status,
                'due_date', i.due_date
            ))
            FROM invoices i
            WHERE i.station_id = p_station_id
            ORDER BY i.created_at DESC
            LIMIT 3
        )
    ) INTO result
    FROM fuel_stations fs
    WHERE fs.station_id = p_station_id;
    
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_tankiq_financial_status"("p_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_hardware_health"("p_station_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'tank_name', t.tank_name,
        'sensor_id', t.sensor_id,
        'last_reading', t.last_reading_at,
        'signal_strength', r.rssi,
        'temperature', t.current_temperature,
        'status', t.status
    ))
    FROM tanks t
    LEFT JOIN LATERAL (
        SELECT rssi
        FROM sensor_readings
        WHERE tank_id = t.id
        ORDER BY timestamp DESC
        LIMIT 1
    ) r ON TRUE
    WHERE t.station_id = p_station_id
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;


ALTER FUNCTION "public"."get_tankiq_hardware_health"("p_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_market_context"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'latest_prices', (
            SELECT jsonb_agg(jsonb_build_object(
                'fuel_type', fuel_type,
                'price',     price_per_liter,
                'source',    source,
                'date',      effective_date
            ))
            FROM (
                SELECT DISTINCT ON (fuel_type)
                    fuel_type, price_per_liter, source, effective_date
                FROM market_prices
                WHERE source = 'epra'
                ORDER BY fuel_type, effective_date DESC
            ) prices_sub
        ),
        'regulatory_notices', (
            SELECT jsonb_agg(jsonb_build_object(
                'title',          title,
                'summary',        summary,
                'effective_date', effective_date
            ))
            FROM (
                SELECT title, summary, effective_date, created_at
                FROM regulatory_notices
                ORDER BY created_at DESC
                LIMIT 2
            ) notices_sub
        )
    ) INTO result;

    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_tankiq_market_context"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_shift_analytics"("p_station_id" "uuid", "p_limit" integer DEFAULT 5) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'tank_name', t.tank_name,
        'closed_at', s.closed_at,
        'volume_sold', s.volume_sold_liters,
        'status', s.status,
        'variance', s.variance_data,
        'collections', s.received_collections
    ))
    FROM shift_closures s
    JOIN tanks t ON s.tank_id = t.id
    WHERE s.station_id = p_station_id
    ORDER BY s.closed_at DESC
    LIMIT p_limit
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;


ALTER FUNCTION "public"."get_tankiq_shift_analytics"("p_station_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_station_summary"("p_station_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'station_id', p_station_id,
        'timestamp', now(),
        'tanks', (
            SELECT jsonb_agg(jsonb_build_object(
                'label', tank_name,
                'fuel_type', fuel_type,
                'capacity', tank_capacity,
                'current_volume', current_volume,
                'fill_percent', ROUND((current_volume / NULLIF(tank_capacity, 0) * 100)::NUMERIC, 1)
            ))
            FROM tanks
            WHERE station_id = p_station_id AND status = 'active'
        ),
        'recent_alerts', (
            SELECT jsonb_agg(jsonb_build_object(
                'type', alert_type,
                'severity', severity,
                'message', message,
                'time', created_at
            ))
            FROM (
                SELECT alert_type, severity, message, created_at
                FROM alerts
                WHERE station_id = p_station_id AND is_resolved = false
                ORDER BY created_at DESC
                LIMIT 5
            ) sub
        )
    ) INTO result;
    
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_tankiq_station_summary"("p_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_support_summary"("p_station_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'subject', subject,
        'status', status,
        'priority', priority,
        'created_at', created_at
    ))
    FROM support_tickets
    WHERE station_id = p_station_id
    ORDER BY created_at DESC
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;


ALTER FUNCTION "public"."get_tankiq_support_summary"("p_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tankiq_usage_insights"("p_station_id" "uuid", "p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'usage_type', usage_type,
        'total_quantity', SUM(quantity),
        'total_cost', SUM(total_cost)
    ))
    FROM usage_logs
    WHERE station_id = p_station_id
      AND timestamp > (now() - (p_days || ' days')::INTERVAL)
    GROUP BY usage_type
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;


ALTER FUNCTION "public"."get_tankiq_usage_insights"("p_station_id" "uuid", "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_bundle_v2"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE v_bundle JSONB;
BEGIN
  WITH identity_set AS (
    -- System Governance Users (Super Admins, etc.)
    SELECT
      'system'::TEXT          AS identity_type,
      u.id                    AS auth_user_id,
      u.email,
      su.role                 AS role,
      1                       AS auth_level,
      NULL::UUID              AS station_id,
      'IoTank Governance'     AS station_name,
      'support@iotank.com'    AS station_email,
      '/iotank-logo.png'      AS logo_url,
      'System Guardian'       AS display_name,
      NULL                    AS photo_url,
      NULL::JSONB             AS address,
      NULL::TEXT              AS phone_number,
      to_jsonb(ARRAY[]::uuid[]) AS site_ids,
      su.created_at
    FROM auth.users u
    JOIN public.system_users su ON u.id = su.auth_user_id
    WHERE su.is_active = TRUE AND u.id = auth.uid()

    UNION ALL

    -- Station Users (Owners, Admins, Staff)
    SELECT
      'station'::TEXT         AS identity_type,
      u.id                    AS auth_user_id,
      p.email,
      p.role                  AS role,
      CASE 
        WHEN p.role = 'owner' THEN 5
        WHEN p.role = 'admin' THEN 5
        WHEN p.role = 'supervisor' THEN 6
        WHEN p.role = 'operator' THEN 7
        ELSE 8 
      END                     AS auth_level,
      p.station_id            AS station_id,
      COALESCE(fs.station_name, 'Organization Setup Pending') AS station_name,
      COALESCE(fs.email, p.email) AS station_email,
      fs.logo_url             AS logo_url,
      p.display_name,
      p.photo_url,
      -- Map the fuel_stations location columns to the address JSONB object
      CASE 
        WHEN fs.county IS NOT NULL OR fs.station_location IS NOT NULL THEN
          jsonb_build_object('state', fs.county, 'city', fs.station_location)
        ELSE NULL::JSONB
      END                     AS address,
      fs.phone                AS phone_number,
      to_jsonb(COALESCE(p.site_ids, '{}')) AS site_ids,
      p.created_at
    FROM auth.users u
    JOIN public.profiles p ON u.id = p.auth_user_id
    LEFT JOIN public.fuel_stations fs ON p.station_id = fs.station_id
    WHERE u.id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = u.id AND is_active = TRUE)
  )
  SELECT to_jsonb(identity_set) INTO v_bundle FROM identity_set LIMIT 1;

  RETURN v_bundle;
END;
$$;


ALTER FUNCTION "public"."get_user_bundle_v2"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_bundle_v2"() IS 'Definitive identity resolver. Replaces all legacy firebase_uid lookups.';



CREATE OR REPLACE FUNCTION "public"."get_user_client_id"() RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$ BEGIN RETURN public.get_user_station_id(); END; $$;


ALTER FUNCTION "public"."get_user_client_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_station_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_station_id UUID;
BEGIN
  SELECT station_id INTO v_station_id FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1;
  RETURN COALESCE(v_station_id, '00000000-0000-0000-0000-000000000000'::UUID);
END;
$$;


ALTER FUNCTION "public"."get_user_station_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_station_setup"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.sub_status := 'TRIAL';
    NEW.trial_ends_at := NOW() + INTERVAL '14 days';
    NEW.current_debt := 0;
    NEW.total_paid := 0;
    NEW.next_billing_date := NOW() + INTERVAL '14 days'; -- First bill generated 30 days AFTER trial ends, but billing cycle starts here
    
    -- Record Audit Event
    INSERT INTO unified_events (
        station_id,
        event_category,
        event_type,
        description,
        metadata
    ) VALUES (
        NEW.station_id,
        'SYSTEM',
        'ACCOUNT_CREATED',
        'Station ' || NEW.station_name || ' initialized on 14-day free trial.',
        jsonb_build_object(
            'trial_ends_at', NEW.trial_ends_at,
            'sub_status', 'TRIAL'
        )
    );
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_station_setup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_station_setup_after"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    INSERT INTO public.unified_events (
        station_id,
        event_category,
        event_type,
        description,
        metadata,
        severity
    ) VALUES (
        NEW.station_id,
        'SYSTEM',
        'ACCOUNT_CREATED',
        'Station ' || NEW.station_name || ' initialized on 14-day free trial.',
        jsonb_build_object(
            'trial_ends_at', NEW.trial_ends_at,
            'sub_status', 'TRIAL'
        ),
        'INFO'
    );
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_station_setup_after"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_station_setup_before"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.sub_status := 'TRIAL';
    NEW.trial_ends_at := NOW() + INTERVAL '14 days';
    NEW.current_debt := 0;
    NEW.total_paid := 0;
    NEW.next_billing_date := NOW() + INTERVAL '14 days';
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_station_setup_before"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
  INSERT INTO public.profiles (auth_user_id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'viewer'
  )
  ON CONFLICT (auth_user_id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_client_access"("required_level" integer DEFAULT 7) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  u_level INTEGER := public.get_auth_level();
BEGIN
  -- System admins (1-4) have access to everything
  IF u_level <= 4 THEN
    RETURN TRUE;
  END IF;
  
  -- Client users (5-7) must have a level <= required
  RETURN u_level <= required_level;
END;
$$;


ALTER FUNCTION "public"."has_client_access"("required_level" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN internal.check_is_admin_internal(auth.uid(), 'super_admin');
END;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_system_admin"("minimum_level" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
    v_min_role TEXT;
BEGIN
    v_min_role := CASE minimum_level
        WHEN 1 THEN 'super_admin'
        WHEN 2 THEN 'admin_helper'
        WHEN 3 THEN 'support_staff'
        WHEN 4 THEN 'analyst'
        ELSE NULL
    END;
    RETURN internal.check_is_admin_internal(auth.uid(), v_min_role);
END;
$$;


ALTER FUNCTION "public"."is_system_admin"("minimum_level" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_system_admin"("minimum_role" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    RETURN internal.check_is_admin_internal(auth.uid(), minimum_role);
END;
$$;


ALTER FUNCTION "public"."is_system_admin"("minimum_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_admin_action"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_action_type TEXT := TG_ARGV[0];
  v_description TEXT := TG_ARGV[1];
  v_admin_uid UUID;
  v_system_user_id UUID;
BEGIN
  v_admin_uid := auth.uid();
  
  -- If this is an automated system action (no auth context), bypass logging
  IF v_admin_uid IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Resolve system_user_id first
    SELECT id INTO v_system_user_id FROM public.system_users WHERE auth_user_id = v_admin_uid LIMIT 1;

    INSERT INTO public.admin_logs (
      system_user_id,
      auth_user_id,
      action_type,
      affected_station_id,
      description,
      changes_made
    ) VALUES (
      v_system_user_id,
      v_admin_uid,
      v_action_type,
      CASE 
        WHEN TG_TABLE_NAME = 'fuel_stations' THEN NEW.station_id  -- UPDATED
        WHEN TG_TABLE_NAME = 'transactions' THEN (NEW.station_id)::uuid
        WHEN TG_TABLE_NAME = 'tanks' THEN (NEW.station_id)::uuid
        ELSE NULL 
      END,
      v_description,
      jsonb_build_object('new', row_to_json(NEW))
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never let an audit log failure crash the main transaction
    RAISE WARNING 'Audit Login Failed: % (SQL_STATE: %)', SQLERRM, SQLSTATE;
  END;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_admin_action"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_auth_attempt"("p_email" "text", "p_is_success" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_ip_raw TEXT;
    v_ip INET;
BEGIN
    v_ip_raw := current_setting('request.headers', true)::json->>'x-real-ip';
    BEGIN
        v_ip := v_ip_raw::INET;  -- FIX: use direct cast instead of net extension
    EXCEPTION WHEN OTHERS THEN
        v_ip := NULL;
    END;

    INSERT INTO public.auth_attempts (email, is_success, ip_address)
    VALUES (LOWER(TRIM(p_email)), p_is_success, v_ip);
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.auth_attempts (email, is_success)
    VALUES (LOWER(TRIM(p_email)), p_is_success);
END;
$$;


ALTER FUNCTION "public"."log_auth_attempt"("p_email" "text", "p_is_success" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_auth_attempt"("p_email" "text", "p_success" boolean, "p_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    INSERT INTO public.security_telemetry_events (
        event_type,
        severity,
        source,
        actor_email,
        reason,
        details
    ) VALUES (
        'AUTH_ATTEMPT',
        CASE WHEN p_success THEN 'info' ELSE 'warning' END,
        'auth',
        p_email,
        CASE WHEN p_success THEN 'Login successful' ELSE 'Login failed' END,
        jsonb_build_object(
            'ip',         p_ip,
            'user_agent', p_user_agent,
            'success',    p_success
        )
    );
EXCEPTION WHEN OTHERS THEN
    -- Never fail an auth operation due to logging errors
    RAISE WARNING 'log_auth_attempt failed: %', SQLERRM;
END;
$$;


ALTER FUNCTION "public"."log_auth_attempt"("p_email" "text", "p_success" boolean, "p_ip" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_auth_event"("p_event_type" "text", "p_user_email" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_status" "text", "p_error_message" "text" DEFAULT NULL::"text", "p_detail_json" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    INSERT INTO public.auth_events (
        event_type, user_id, user_email, ip_address, user_agent,
        status, error_message, detail_json
    ) VALUES (
        p_event_type, auth.uid(), p_user_email, p_ip_address, p_user_agent,
        p_status, p_error_message, p_detail_json
    );
EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail auth operations
    RAISE WARNING 'Failed to log auth event: %', SQLERRM;
END;
$$;


ALTER FUNCTION "public"."log_auth_event"("p_event_type" "text", "p_user_email" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_status" "text", "p_error_message" "text", "p_detail_json" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_registration_event"("p_registration_id" "uuid", "p_event_type" "text", "p_actor_email" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text", "p_detail_json" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    INSERT INTO public.unified_events (
        event_category,
        event_type,
        description,
        actor_id,
        actor_email,
        metadata
    ) VALUES (
        'SYSTEM',
        'REGISTRATION_' || UPPER(p_event_type),
        COALESCE(p_notes, 'Registration event: ' || p_event_type),
        auth.uid(),
        p_actor_email,
        jsonb_build_object(
            'registration_id', p_registration_id,
            'details', p_detail_json
        )
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to log registration event: %', SQLERRM;
END;
$$;


ALTER FUNCTION "public"."log_registration_event"("p_registration_id" "uuid", "p_event_type" "text", "p_actor_email" "text", "p_notes" "text", "p_detail_json" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_security_telemetry_event"("p_event_type" "text", "p_severity" "text" DEFAULT 'info'::"text", "p_source" "text" DEFAULT 'edge_function'::"text", "p_endpoint" "text" DEFAULT NULL::"text", "p_actor_uid" "uuid" DEFAULT NULL::"uuid", "p_actor_email" "text" DEFAULT NULL::"text", "p_actor_role" "text" DEFAULT NULL::"text", "p_actor_auth_level" integer DEFAULT NULL::integer, "p_station_id" "uuid" DEFAULT NULL::"uuid", "p_scope_key" "text" DEFAULT NULL::"text", "p_status_code" integer DEFAULT NULL::integer, "p_reason" "text" DEFAULT NULL::"text", "p_details" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.security_telemetry_events (
    event_type,
    severity,
    source,
    endpoint,
    actor_uid,
    actor_email,
    actor_role,
    actor_auth_level,
    station_id, -- Updated
    scope_key,
    status_code,
    reason,
    details
  )
  VALUES (
    p_event_type,
    COALESCE(p_severity, 'info'),
    COALESCE(p_source, 'edge_function'),
    p_endpoint,
    p_actor_uid,
    p_actor_email,
    p_actor_role,
    p_actor_auth_level,
    p_station_id, -- Updated
    p_scope_key,
    p_status_code,
    p_reason,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."log_security_telemetry_event"("p_event_type" "text", "p_severity" "text", "p_source" "text", "p_endpoint" "text", "p_actor_uid" "uuid", "p_actor_email" "text", "p_actor_role" "text", "p_actor_auth_level" integer, "p_station_id" "uuid", "p_scope_key" "text", "p_status_code" integer, "p_reason" "text", "p_details" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_alert_tampering"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        -- Rule A: If the alert was ALREADY resolved, absolutely NO changes allowed (except perhaps metadata)
        IF (OLD.is_resolved = true AND NEW.is_resolved = true) THEN
             IF (OLD.id IS NOT DISTINCT FROM NEW.id AND 
                OLD.station_id IS NOT DISTINCT FROM NEW.station_id AND
                OLD.tank_id IS NOT DISTINCT FROM NEW.tank_id AND
                OLD.alert_type IS NOT DISTINCT FROM NEW.alert_type AND
                OLD.severity IS NOT DISTINCT FROM NEW.severity AND
                OLD.title IS NOT DISTINCT FROM NEW.title AND
                OLD.message IS NOT DISTINCT FROM NEW.message AND
                OLD.created_at IS NOT DISTINCT FROM NEW.created_at) THEN
                RETURN NEW;
             END IF;
             RAISE EXCEPTION 'Forensic Integrity Violation: Resolved alert history is immutable and cannot be modified.';
        END IF;

        -- Rule B: If the alert is ACTIVE, we allow updates to severity, title, and message
        -- (This supports the 'upsert_alert_v2' pulse-update logic)
        -- But we still block tampering with core identity (id, station, tank, type, created_at)
        IF (OLD.id IS NOT DISTINCT FROM NEW.id AND 
            OLD.station_id IS NOT DISTINCT FROM NEW.station_id AND
            OLD.tank_id IS NOT DISTINCT FROM NEW.tank_id AND
            OLD.alert_type IS NOT DISTINCT FROM NEW.alert_type AND
            OLD.created_at IS NOT DISTINCT FROM NEW.created_at) THEN
            
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Forensic Integrity Violation: Alert identity (Station, Tank, Type, Timestamp) is immutable.';
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."prevent_alert_tampering"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_audit_tampering"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Allow updating ONLY the is_resolved column
    IF (TG_OP = 'UPDATE') THEN
        IF (OLD.id = NEW.id AND 
            OLD.station_id = NEW.station_id AND
            OLD.event_category = NEW.event_category AND
            OLD.event_type = NEW.event_type AND
            OLD.description = NEW.description AND
            OLD.actor_id = NEW.actor_id AND
            OLD.actor_email = NEW.actor_email AND
            OLD.metadata = NEW.metadata AND
            OLD.created_at = NEW.created_at) THEN
            
            -- Only is_resolved changed (or nothing changed)
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Forensic Integrity Violation: Audit logs (unified_events) are immutable and only the resolution status can be modified.';
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."prevent_audit_tampering"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_negative_debt"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.current_debt < 0 THEN
    RAISE EXCEPTION 'Debt cannot be negative. Current attempt: %', NEW.current_debt;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_negative_debt"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_payment"("p_station_id" "uuid", "p_amount" numeric, "p_payment_method" "text", "p_payment_reference" "text", "p_description" "text" DEFAULT 'Payment received'::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
    v_old_debt DECIMAL;
    v_new_debt DECIMAL;
    v_caller_uid UUID := auth.uid();
BEGIN
    -- 1. Authorization check: Caller must own the station OR be an admin
    IF NOT (
        EXISTS (SELECT 1 FROM public.fuel_stations WHERE station_id = p_station_id AND owner_id = v_caller_uid)
        OR public.is_admin()
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Access denied to fuel_stations record';
    END IF;

    -- 2. Fetch current debt
    SELECT current_debt INTO v_old_debt
    FROM public.fuel_stations
    WHERE station_id = p_station_id;

    IF v_old_debt IS NULL THEN
        RAISE EXCEPTION 'Station with ID % not found', p_station_id;
    END IF;

    -- 3. Calculate new debt (Floor at 0)
    v_new_debt := GREATEST(0, v_old_debt - p_amount);

    -- 4. Update Station Ledger
    UPDATE public.fuel_stations
    SET current_debt = v_new_debt,
        total_paid = total_paid + p_amount,
        updated_at = NOW()
    WHERE station_id = p_station_id;

    -- 5. Record Transaction
    INSERT INTO public.transactions (
        station_id,
        transaction_type,
        amount,
        description,
        payment_method,
        payment_reference,
        payment_status,
        created_at,
        completed_at
    ) VALUES (
        p_station_id,
        'payment',
        p_amount,
        p_description,
        p_payment_method,
        p_payment_reference,
        'completed',
        NOW(),
        NOW()
    );

    -- 6. Record in unified_events
    INSERT INTO public.unified_events (
        station_id,
        event_category,
        event_type,
        description,
        actor_id,
        metadata
    ) VALUES (
        p_station_id,
        'FINANCE',
        'PAYMENT_RECEIVED',
        'Payment of KSh ' || p_amount || ' received via ' || p_payment_method,
        v_caller_uid,
        jsonb_build_object(
            'amount', p_amount,
            'method', p_payment_method,
            'reference', p_payment_reference,
            'new_debt', v_new_debt
        )
    );
END;
$$;


ALTER FUNCTION "public"."process_payment"("p_station_id" "uuid", "p_amount" numeric, "p_payment_method" "text", "p_payment_reference" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."provision_registration_v2"("p_registration_id" "uuid", "p_auth_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_reg RECORD;
    v_station_id UUID;
    v_site_id UUID;
BEGIN
    -- 1. Fetch Registration
    SELECT * INTO v_reg FROM public.pending_registrations WHERE id = p_registration_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Registration not found');
    END IF;

    -- 2. Atomic Station Creation
    INSERT INTO public.fuel_stations (
        station_name, 
        email,
        owner_id,
        account_status
    ) VALUES (
        v_reg.station_name,
        LOWER(v_reg.email),
        p_auth_user_id,
        'active'
    )
    ON CONFLICT (email) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        station_name = EXCLUDED.station_name,
        account_status = 'active'
    RETURNING station_id INTO v_station_id; -- UPDATED

    -- 3. Atomic Site Creation
    INSERT INTO public.sites (
        station_id,
        site_name,
        auth_user_id
    ) VALUES (
        v_station_id,
        v_reg.station_name, 
        p_auth_user_id
    )
    ON CONFLICT (station_id, site_name) DO UPDATE SET
        auth_user_id = EXCLUDED.auth_user_id
    RETURNING id INTO v_site_id;

    -- 4. Atomic Profile Linkage
    INSERT INTO public.profiles (
        auth_user_id,
        email,
        display_name,
        station_id,
        role,
        site_ids
    ) VALUES (
        p_auth_user_id,
        LOWER(v_reg.email),
        v_reg.full_name,
        v_station_id,
        'owner',
        ARRAY[v_site_id]
    )
    ON CONFLICT (auth_user_id) DO UPDATE SET
        station_id = EXCLUDED.station_id,
        role = EXCLUDED.role,
        site_ids = EXCLUDED.site_ids,
        display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), profiles.display_name);

    -- 5. Finalize Registration Status
    UPDATE public.pending_registrations
    SET status = 'approved',
        approved_at = NOW(),
        approved_auth_user_id = p_auth_user_id,
        approved_station_id = v_station_id
    WHERE id = p_registration_id;

    RETURN jsonb_build_object(
        'success', true, 
        'station_id', v_station_id, 
        'site_id', v_site_id,
        'message', 'Provisioning completed atomically'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false, 
        'error', SQLERRM,
        'detail', SQLSTATE
    );
END;
$$;


ALTER FUNCTION "public"."provision_registration_v2"("p_registration_id" "uuid", "p_auth_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_tank_analytics"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.tank_analytics_30d;
END;
$$;


ALTER FUNCTION "public"."refresh_tank_analytics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."repair_my_identity"() RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
    v_email TEXT;
    v_uid UUID;
    v_email_verified BOOLEAN;
    v_updated BOOLEAN := FALSE;
BEGIN
    v_uid := auth.uid();
    v_email := LOWER(TRIM(auth.jwt() ->> 'email'));
    -- Check for email verification in JWT
    v_email_verified := (auth.jwt() ->> 'email_verified')::BOOLEAN 
                     OR (auth.jwt() -> 'app_metadata' ->> 'email_verified')::BOOLEAN
                     OR (auth.jwt() -> 'user_metadata' ->> 'email_verified')::BOOLEAN;
    
    -- SECURITY CRITICAL: Do not link if email is NULL or NOT verified.
    IF v_uid IS NULL OR v_email IS NULL OR (v_email_verified IS NOT TRUE AND v_email NOT LIKE '%@gmail.com') THEN
        -- Allow gmail.com for now as it's often pre-verified by Google auth
        IF v_email NOT LIKE '%@gmail.com' THEN
             RETURN FALSE;
        END IF;
    END IF;

    -- 1. Link profile if not linked and emails match
    UPDATE public.profiles 
    SET auth_user_id = v_uid,
        updated_at = NOW()
    WHERE auth_user_id IS NULL 
      AND LOWER(TRIM(email)) = v_email;
    
    IF FOUND THEN 
        v_updated := TRUE; 
        INSERT INTO public.audit_logs (action, details, created_at)
        VALUES ('IDENTITY_REPAIR', 'Linked profile ' || v_email || ' to UID ' || v_uid::text, NOW());
    END IF;

    -- 2. Link system user if not linked and emails match
    UPDATE public.system_users 
    SET auth_user_id = v_uid,
        updated_at = NOW()
    WHERE auth_user_id IS NULL 
      AND LOWER(TRIM(email)) = v_email;

    IF FOUND THEN 
        v_updated := TRUE; 
        INSERT INTO public.audit_logs (action, details, created_at)
        VALUES ('IDENTITY_REPAIR', 'Linked system_user ' || v_email || ' to UID ' || v_uid::text, NOW());
    END IF;

    RETURN v_updated;
END;
$$;


ALTER FUNCTION "public"."repair_my_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_all_station_events"("p_station_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_station_id uuid;
BEGIN
    -- Get user's station_id
    SELECT station_id INTO v_user_station_id FROM public.profiles WHERE auth_user_id = auth.uid();
    
    -- Security Check
    IF v_user_station_id = p_station_id OR EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = auth.uid() AND is_active = TRUE) THEN
        -- 1. Resolve all events for the station
        UPDATE public.unified_events 
        SET is_resolved = true 
        WHERE station_id = p_station_id AND is_resolved = false;

        -- 2. Atomic: Resolve all alerts for the station to ensure UI consistency
        UPDATE public.alerts
        SET is_resolved = true,
            resolved_at = NOW(),
            resolved_by = 'SYSTEM_BATCH_SYNC'
        WHERE station_id = p_station_id AND is_resolved = false;
    ELSE
        RAISE EXCEPTION 'Access Denied: You do not have permission to resolve events for this station.';
    END IF;
END;
$$;


ALTER FUNCTION "public"."resolve_all_station_events"("p_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_unified_event"("p_event_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_station_id uuid;
    v_event_station_id uuid;
    v_source_id uuid;
BEGIN
    -- Get user's station_id (handles both station users and system users)
    SELECT station_id INTO v_user_station_id FROM public.profiles WHERE auth_user_id = auth.uid();
    
    -- Get event's station_id and source_id from metadata
    SELECT station_id, (metadata->>'source_id')::uuid INTO v_event_station_id, v_source_id 
    FROM public.unified_events WHERE id = p_event_id;
    
    -- Security Check: Ensure user belongs to the station OR is a system admin
    IF v_user_station_id = v_event_station_id OR EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = auth.uid() AND is_active = TRUE) THEN
        -- 1. Resolve the event
        UPDATE public.unified_events 
        SET is_resolved = true 
        WHERE id = p_event_id;

        -- 2. Atomic: Resolve linked alert if exists
        IF v_source_id IS NOT NULL THEN
            UPDATE public.alerts 
            SET is_resolved = true, 
                resolved_at = NOW(), 
                resolved_by = 'SYSTEM_SYNC'
            WHERE id = v_source_id AND is_resolved = false;
        END IF;
    ELSE
        RAISE EXCEPTION 'Access Denied: You do not have permission to resolve events for this station.';
    END IF;
END;
$$;


ALTER FUNCTION "public"."resolve_unified_event"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_sensor_reading_station_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- If station_id is missing, look it up from the tank record
    IF NEW.station_id IS NULL THEN
        SELECT station_id INTO NEW.station_id 
        FROM public.tanks 
        WHERE id = NEW.tank_id;
    END IF;
    
    -- Safety: If tank_id was invalid or tank has no station, we must block
    IF NEW.station_id IS NULL THEN
        RAISE EXCEPTION 'Ingestion Failed: tank_id % is not associated with any station.', NEW.tank_id;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_sensor_reading_station_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."setup_security_pin"("p_pin_hash" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    -- Update profiles
    UPDATE public.profiles
    SET 
        security_pin_hash = p_pin_hash,
        security_pin_enabled = TRUE,
        last_pin_change_at = NOW()
    WHERE auth_user_id = auth.uid();

    -- Update system_users
    UPDATE public.system_users
    SET security_pin_enabled = TRUE
    WHERE auth_user_id = auth.uid();
END;
$$;


ALTER FUNCTION "public"."setup_security_pin"("p_pin_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_master_password"("new_password" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE public.fuel_stations
    SET master_password = new_password
    WHERE station_id = (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid());
END;
$$;


ALTER FUNCTION "public"."update_master_password"("new_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_tank_from_sensor"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE public.tanks
    SET 
        current_volume = NEW.volume,
        last_reading_at = NEW.captured_at, -- Use the actual telemetry timestamp
        last_rssi = NEW.rssi,
        updated_at = NOW()
    WHERE id = NEW.tank_id;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_tank_from_sensor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_team_member_requests_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_team_member_requests_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$ BEGIN RETURN '{}'::jsonb; END; $$;


ALTER FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_title" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_alert_id UUID;
  v_existing_id UUID;
BEGIN
  -- 1. Check for an active (unresolved) alert of the same type for this tank
  SELECT id INTO v_existing_id
  FROM alerts
  WHERE station_id = p_station_id
    AND tank_id = p_tank_id
    AND alert_type = p_alert_type
    AND is_resolved = false
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- 2. Update existing active alert (Pulse Update)
    UPDATE alerts
    SET 
      title = p_title,
      message = p_message,
      severity = p_severity,
      metadata = p_metadata,
      updated_at = NOW()
    WHERE id = v_existing_id
    RETURNING id INTO v_alert_id;
    
    RETURN jsonb_build_object('id', v_alert_id, 'action', 'updated');
  ELSE
    -- 3. Insert new alert
    INSERT INTO alerts (
      station_id,
      tank_id,
      alert_type,
      title,
      message,
      severity,
      metadata,
      is_resolved,
      created_at
    )
    VALUES (
      p_station_id,
      p_tank_id,
      p_alert_type,
      p_title,
      p_message,
      p_severity,
      p_metadata,
      false,
      NOW()
    )
    RETURNING id INTO v_alert_id;
    
    RETURN jsonb_build_object('id', v_alert_id, 'action', 'created');
  END IF;
END;
$$;


ALTER FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_title" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_owns_client"("client_firebase_uid" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN public.firebase_uid() = client_firebase_uid;
END;
$$;


ALTER FUNCTION "public"."user_owns_client"("client_firebase_uid" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_reading_station_match"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.tanks
        WHERE id = NEW.tank_id AND station_id = NEW.station_id
    ) THEN
        RAISE EXCEPTION 'Telemetry Integrity Failure: Station ownership mismatch for tank %', NEW.tank_id;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_reading_station_match"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_master_password"("test_password" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_master_password TEXT;
BEGIN
    -- Get the master password for the station associated with the user
    SELECT master_password INTO v_master_password
    FROM public.fuel_stations
    WHERE station_id = (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid());

    -- If no master password is set, we use a fallback or return false
    -- For security, if it is null, we return false (user must set it via 'update_master_password')
    IF v_master_password IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN v_master_password = test_password;
END;
$$;


ALTER FUNCTION "public"."verify_master_password"("test_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_security_pin"("p_pin_hash" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_stored_hash TEXT;
BEGIN
    SELECT security_pin_hash INTO v_stored_hash
    FROM profiles
    WHERE auth_user_id = auth.uid();
    
    RETURN v_stored_hash = p_pin_hash;
END;
$$;


ALTER FUNCTION "public"."verify_security_pin"("p_pin_hash" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_recommendations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "recommendation_type" "text",
    "confidence_score" numeric(5,2),
    "reasoning" "text" NOT NULL,
    "current_price" numeric(10,2),
    "predicted_price_7day" numeric(10,2),
    "predicted_price_14day" numeric(10,2),
    "potential_savings" numeric(10,2),
    "risk_level" "text",
    "user_action" "text",
    "user_action_date" timestamp without time zone,
    "was_accurate" boolean,
    "actual_outcome" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "expires_at" timestamp without time zone,
    CONSTRAINT "ai_recommendations_confidence_score_check" CHECK ((("confidence_score" >= (0)::numeric) AND ("confidence_score" <= (100)::numeric))),
    CONSTRAINT "ai_recommendations_recommendation_type_check" CHECK (("recommendation_type" = ANY (ARRAY['buy_now'::"text", 'wait'::"text", 'monitor'::"text"]))),
    CONSTRAINT "ai_recommendations_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "ai_recommendations_user_action_check" CHECK (("user_action" = ANY (ARRAY['followed'::"text", 'ignored'::"text", 'deferred'::"text", 'pending'::"text"])))
);


ALTER TABLE "public"."ai_recommendations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "tank_id" "uuid",
    "alert_type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "alert_data" "jsonb",
    "is_read" boolean DEFAULT false,
    "is_acknowledged" boolean DEFAULT false,
    "acknowledged_at" timestamp without time zone,
    "acknowledged_by_auth_id" "text",
    "sms_sent" boolean DEFAULT false,
    "sms_sent_at" timestamp without time zone,
    "email_sent" boolean DEFAULT false,
    "email_sent_at" timestamp without time zone,
    "push_sent" boolean DEFAULT false,
    "push_sent_at" timestamp without time zone,
    "is_resolved" boolean DEFAULT false,
    "resolved_at" timestamp without time zone,
    "resolution_notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "expires_at" timestamp without time zone,
    "auth_user_id" "uuid",
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "supabase_uid" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "resolved_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "alerts_alert_type_check" CHECK (("alert_type" = ANY (ARRAY['low-level'::"text", 'low_level'::"text", 'low_fuel'::"text", 'low-fuel'::"text", 'low_level_critical'::"text", 'low_level_warning'::"text", 'overfill'::"text", 'high_temperature'::"text", 'high-temperature'::"text", 'sensor-failure'::"text", 'sensor_failure'::"text", 'sensor_offline'::"text", 'sensor-offline'::"text", 'telemetry-gap'::"text", 'telemetry_gap'::"text", 'connectivity-lost'::"text", 'connectivity_lost'::"text", 'anomaly'::"text", 'system_error'::"text", 'system-error'::"text", 'sensor-blackout'::"text", 'sensor_blackout'::"text", 'calibration_due'::"text", 'calibration-due'::"text", 'payment_overdue'::"text", 'payment-overdue'::"text", 'warning_high'::"text", 'warning-high'::"text", 'reorder_point'::"text", 'reorder-point'::"text", 'leak'::"text", 'leak-detected'::"text", 'leak_detected'::"text", 'refill'::"text", 'refill-detected'::"text", 'refill_detected'::"text", 'unauthorized-refill'::"text", 'unauthorized_refill'::"text", 'theft'::"text", 'theft-detected'::"text", 'theft_detected'::"text", 'night_drawdown'::"text", 'night-drawdown'::"text", 'market-news'::"text", 'market_news'::"text", 'regulatory-update'::"text", 'regulatory_update'::"text", 'delivery-variance'::"text", 'delivery_variance'::"text", 'compliance-deadline'::"text", 'compliance_deadline'::"text", 'price_review'::"text", 'price-review'::"text", 'composite'::"text", 'composite_supply_risk'::"text", 'info'::"text", 'warning'::"text", 'error'::"text", 'critical'::"text", 'success'::"text", 'system'::"text", 'maintenance'::"text", 'test'::"text", 'operational-alert'::"text", 'operational_alert'::"text", 'delivery'::"text", 'delivery_added'::"text", 'delivery-added'::"text", 'shift_open'::"text", 'shift-open'::"text", 'shift_close'::"text", 'shift-close'::"text"]))),
    CONSTRAINT "alerts_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text", 'info'::"text", 'warning'::"text", 'watch'::"text"])))
);


ALTER TABLE "public"."alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analysis_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_id" "uuid",
    "station_id" "uuid",
    "analysis_type" "text",
    "analysis_result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."analysis_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "action" "text" NOT NULL,
    "user_name" "text",
    "station_id" "uuid",
    "details" "text",
    "severity" "text" DEFAULT 'info'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "changes_made" "jsonb",
    "before_values" "jsonb",
    "after_values" "jsonb",
    "user_email" "text",
    CONSTRAINT "audit_logs_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."audit_logs"."user_email" IS 'Email of the user who performed the action';



CREATE TABLE IF NOT EXISTS "public"."auth_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "ip_address" "inet",
    "attempted_at" timestamp with time zone DEFAULT "now"(),
    "is_success" boolean DEFAULT false
);


ALTER TABLE "public"."auth_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."auth_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text",
    "user_id" "uuid",
    "user_email" "text",
    "ip_address" "inet",
    "user_agent" "text",
    "status" "text",
    "error_message" "text",
    "detail_json" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "auth_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['LOGIN_ATTEMPT'::"text", 'LOGIN_SUCCESS'::"text", 'LOGIN_FAILURE'::"text", 'LOGOUT'::"text", 'PASSWORD_CHANGE'::"text", 'EMAIL_VERIFICATION_SENT'::"text", 'EMAIL_VERIFIED'::"text", 'ACCOUNT_CREATED'::"text", 'ACCOUNT_DELETED'::"text", 'ROLE_CHANGED'::"text", 'PERMISSION_DENIED'::"text", 'SESSION_TIMEOUT'::"text"]))),
    CONSTRAINT "auth_events_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'failure'::"text", 'warning'::"text"])))
);


ALTER TABLE "public"."auth_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "paystack_customer_code" "text",
    "email" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "phone" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."billing_customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "paystack_plan_code" "text",
    "name" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'KES'::"text",
    "interval" "text" DEFAULT 'monthly'::"text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "billing_plans_interval_check" CHECK (("interval" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text", 'quarterly'::"text", 'annually'::"text"])))
);


ALTER TABLE "public"."billing_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "customer_id" "uuid",
    "plan_id" "uuid",
    "paystack_subscription_code" "text",
    "status" "text" DEFAULT 'active'::"text",
    "next_payment_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."billing_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'KES'::"text",
    "provider" "text" NOT NULL,
    "provider_ref" "text",
    "status" "text" DEFAULT 'PENDING'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "billing_transactions_provider_check" CHECK (("provider" = ANY (ARRAY['MPESA'::"text", 'PAYSTACK'::"text", 'CASH'::"text", 'BANK_TRANSFER'::"text", 'AIRTEL_MONEY'::"text"])))
);


ALTER TABLE "public"."billing_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."canned_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."canned_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."current_station_shifts" (
    "station_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "current_station_shifts_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'CLOSED'::"text"])))
);


ALTER TABLE "public"."current_station_shifts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."current_station_shifts"."metadata" IS 'Stores volatile shift data including tank_snapshots {tank_id: {opening_volume, captured_at, is_manual_override, original_sensor_value}}';



CREATE TABLE IF NOT EXISTS "public"."daily_summaries" (
    "tank_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "avg_volume" numeric(10,2),
    "avg_temperature" numeric(5,2),
    "reading_count" integer DEFAULT 0,
    "timestamp" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."daily_summaries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dashboard_banners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" DEFAULT 'info'::"text",
    "message" "text" NOT NULL,
    "target" "text" DEFAULT 'All'::"text",
    "is_dismissible" boolean DEFAULT true,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "created_by" "uuid"
);


ALTER TABLE "public"."dashboard_banners" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "tank_id" "uuid",
    "delivery_date" timestamp without time zone NOT NULL,
    "supplier_name" "text",
    "driver_name" "text",
    "truck_number" "text",
    "bol_number" "text",
    "bol_claimed_volume" numeric(10,2),
    "bol_temperature" numeric(5,2),
    "bol_photo_url" "text",
    "tank_before_volume" numeric(10,2),
    "tank_after_volume" numeric(10,2),
    "actual_received_volume" numeric(10,2),
    "actual_temperature" numeric(5,2),
    "variance_volume" numeric(10,2) GENERATED ALWAYS AS (("bol_claimed_volume" - "actual_received_volume")) STORED,
    "variance_percentage" numeric(5,2),
    "verification_status" "text",
    "is_accepted" boolean,
    "dispute_notes" "text",
    "resolution_notes" "text",
    "unit_price" numeric(10,2),
    "total_cost" numeric(12,2),
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "auth_user_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "deliveries_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['pending'::"text", 'verified_ok'::"text", 'disputed_shortage'::"text", 'disputed_overage'::"text", 'under_investigation'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."device_commands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "command" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "processed_at" timestamp with time zone,
    "error_message" "text",
    CONSTRAINT "device_commands_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'processed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."device_commands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."device_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tank_id" "uuid",
    "station_id" "uuid" NOT NULL,
    "issued_by" "uuid",
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "is_revoked" boolean DEFAULT false NOT NULL,
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid",
    "revoke_reason" "text",
    "token_hash" "text" NOT NULL,
    CONSTRAINT "device_tokens_expires_after_issued" CHECK (("expires_at" > "issued_at"))
);


ALTER TABLE "public"."device_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "device_id" "text" NOT NULL,
    "station_id" "uuid",
    "station_name" "text",
    "model" "text",
    "firmware_version" "text",
    "status" "text" DEFAULT 'offline'::"text",
    "last_seen" timestamp with time zone,
    "lat" numeric(9,6),
    "lng" numeric(9,6),
    "ip_address" "text",
    "mac_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "devices_model_check" CHECK (("model" = ANY (ARRAY['ESP32-S3'::"text", 'ESP32-WROOM'::"text"]))),
    CONSTRAINT "devices_status_check" CHECK (("status" = ANY (ARRAY['online'::"text", 'offline'::"text", 'maintenance'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."edge_rate_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_key" "text" NOT NULL,
    "endpoint" "text" NOT NULL,
    "window_starts_at" timestamp with time zone NOT NULL,
    "request_count" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."edge_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."file_uploads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "file_name" "text" NOT NULL,
    "file_type" "text",
    "file_size" integer,
    "storage_path" "text" NOT NULL,
    "public_url" "text",
    "analysis_status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "file_uploads_analysis_status_check" CHECK (("analysis_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "file_uploads_file_type_check" CHECK (("file_type" = ANY (ARRAY['pdf'::"text", 'csv'::"text"])))
);


ALTER TABLE "public"."file_uploads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."firmware_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "target_version" "text" NOT NULL,
    "status" "text" DEFAULT 'in_progress'::"text",
    "total_devices" integer DEFAULT 0,
    "updated_devices" integer DEFAULT 0,
    "failed_devices" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "firmware_campaigns_status_check" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'paused'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."firmware_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fuel_stations" (
    "station_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "station_name" "text" NOT NULL,
    "station_location" "text",
    "county" "text",
    "current_debt" numeric(10,2) DEFAULT 0,
    "total_paid" numeric(10,2) DEFAULT 0,
    "lifetime_revenue" numeric(10,2) DEFAULT 0.00,
    "subscription_status" "text" DEFAULT 'active'::"text",
    "trial_ends_at" timestamp without time zone,
    "subscription_started_at" timestamp without time zone DEFAULT "now"(),
    "last_payment_date" timestamp without time zone,
    "next_billing_date" "date",
    "account_status" "text" DEFAULT 'active'::"text",
    "suspension_reason" "text",
    "grace_period_ends" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "last_login" timestamp without time zone,
    "auth_user_id" "uuid",
    "logo_url" "text",
    "owner_id" "uuid",
    "supabase_uid" "uuid",
    "sub_status" "public"."subscription_status" DEFAULT 'TRIAL'::"public"."subscription_status",
    "sub_tier" "public"."subscription_tier" DEFAULT 'BASIC'::"public"."subscription_tier",
    "sub_expires_at" timestamp with time zone,
    CONSTRAINT "chk_client_email_format" CHECK (("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text")),
    CONSTRAINT "client_billing_account_status_check" CHECK (("account_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'delinquent'::"text", 'closed'::"text"]))),
    CONSTRAINT "client_billing_current_debt_check" CHECK (("current_debt" >= (0)::numeric)),
    CONSTRAINT "client_billing_subscription_status_check" CHECK (("subscription_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'cancelled'::"text", 'trial'::"text"]))),
    CONSTRAINT "valid_email" CHECK (("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text"))
);


ALTER TABLE "public"."fuel_stations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."fuel_stations"."trial_ends_at" IS 'Timestamp when the free trial period expires (default 14 days from approval).';



CREATE TABLE IF NOT EXISTS "public"."fuel_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "tank_id" "uuid",
    "transaction_type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "performed_by_auth_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "auth_user_id" "uuid",
    CONSTRAINT "fuel_transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['delivery'::"text", 'reconciliation'::"text", 'adjustment'::"text", 'loss'::"text", 'sale'::"text", 'purchase'::"text"])))
);


ALTER TABLE "public"."fuel_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."global_announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "channels" "text"[] DEFAULT ARRAY['Dashboard'::"text"],
    "target_audience" "text" DEFAULT 'All'::"text",
    "status" "text" DEFAULT 'sent'::"text",
    "recipients_count" integer DEFAULT 0,
    "open_rate" double precision DEFAULT 0,
    "click_rate" double precision DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."global_announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."internal_api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "name" "text" NOT NULL,
    "prefix" "text" NOT NULL,
    "hashed_key" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."internal_api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "invoice_number" "text" NOT NULL,
    "billing_period_start" "date" NOT NULL,
    "billing_period_end" "date" NOT NULL,
    "amount_due" numeric(12,2) NOT NULL,
    "amount_paid" numeric(12,2) DEFAULT 0,
    "status" "text" DEFAULT 'unpaid'::"text",
    "due_date" "date" NOT NULL,
    "pdf_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['unpaid'::"text", 'partially_paid'::"text", 'paid'::"text", 'void'::"text", 'overdue'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."knowledge_base" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "category" "text" NOT NULL,
    "content" "text",
    "views" integer DEFAULT 0,
    "helpful_count" integer DEFAULT 0,
    "is_published" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."knowledge_base" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sensor_readings_legacy" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tank_id" "uuid",
    "station_id" "uuid",
    "temperature" numeric(5,2),
    "rssi" integer,
    "volume" numeric(10,2),
    "timestamp" timestamp without time zone DEFAULT "now"(),
    "supabase_uid" "uuid",
    "signal_strength" integer,
    CONSTRAINT "check_volume_non_negative" CHECK (("volume" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."sensor_readings_legacy" REPLICA IDENTITY FULL;


ALTER TABLE "public"."sensor_readings_legacy" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sensor_readings_legacy"."volume" IS 'The raw volume reading from the sensor (uncompensated)';



CREATE OR REPLACE VIEW "public"."latest_sensor_readings" AS
 SELECT DISTINCT ON ("tank_id") "id",
    "station_id",
    "tank_id",
    "volume",
    "temperature",
    "timestamp" AS "captured_at",
    '{}'::"jsonb" AS "metadata",
    "rssi"
   FROM "public"."sensor_readings_legacy"
  ORDER BY "tank_id", "timestamp" DESC;


ALTER VIEW "public"."latest_sensor_readings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loss_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "text" NOT NULL,
    "reviewed_by" "uuid",
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "variance_liters" numeric(10,2) NOT NULL,
    "pump_sales" numeric(10,2),
    "tank_drawdown" numeric(10,2),
    "estimated_value_kes" numeric(14,2),
    "selected_cause" "text" NOT NULL,
    "explanation" "text",
    "action_taken" "text" NOT NULL,
    "photo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loss_reviews_action_taken_check" CHECK (("action_taken" = ANY (ARRAY['reviewed'::"text", 'escalated'::"text"]))),
    CONSTRAINT "loss_reviews_selected_cause_check" CHECK (("selected_cause" = ANY (ARRAY['Delivery Adjustment'::"text", 'Shift ReconciliationGap'::"text", 'Meter Calibration'::"text", 'Tank Temperature Shift'::"text", 'Suspected Leak'::"text", 'Unknown'::"text"])))
);


ALTER TABLE "public"."loss_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_action_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "fuel_type" "text" NOT NULL,
    "old_price" numeric(10,2),
    "new_price" numeric(10,2) NOT NULL,
    "effective_date" "date" NOT NULL,
    "action_type" "text" DEFAULT 'price_adjustment'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "market_action_queue_action_type_check" CHECK (("action_type" = ANY (ARRAY['price_adjustment'::"text", 'procurement_hedge'::"text", 'compliance_review'::"text"]))),
    CONSTRAINT "market_action_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'ignored'::"text"])))
);


ALTER TABLE "public"."market_action_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_bookmarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "title" "text" NOT NULL,
    "url" "text",
    "source" "text",
    "published_at" timestamp with time zone,
    "saved_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."market_bookmarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_news" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" NOT NULL,
    "title" "text" NOT NULL,
    "link" "text",
    "pub_date" timestamp with time zone,
    "content_snippet" "text",
    "source_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "attribution" "text",
    "priority" integer DEFAULT 3,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "expires_at" timestamp with time zone,
    "created_by" "uuid"
);


ALTER TABLE "public"."market_news" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fuel_type" "text" NOT NULL,
    "price_per_liter" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'KES'::"text",
    "source" "text" NOT NULL,
    "region" "text" DEFAULT 'kenya'::"text",
    "city" "text",
    "price_type" "text",
    "effective_date" "date" NOT NULL,
    "recorded_at" timestamp without time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "market_prices_price_type_check" CHECK (("price_type" = ANY (ARRAY['retail'::"text", 'wholesale'::"text", 'spot'::"text", 'futures'::"text"]))),
    CONSTRAINT "market_prices_source_check" CHECK (("source" = ANY (ARRAY['epra'::"text", 'bloomberg'::"text", 'manual'::"text", 'api'::"text"])))
);


ALTER TABLE "public"."market_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_signals" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "station_id" "uuid",
    "type" "text",
    "source" "text",
    "source_type" "text",
    "title" "text" NOT NULL,
    "summary" "text",
    "timestamp" bigint,
    "relevance_score" numeric(5,4),
    "confidence_score" numeric(5,4),
    "external_url" "text",
    "attribution" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."market_signals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketing_leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "source" "text" DEFAULT 'lead_magnet_newsletter'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "marketing_leads_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'unsubscribed'::"text"])))
);


ALTER TABLE "public"."marketing_leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."newsletter_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "subject" "text",
    "content_json" "jsonb" DEFAULT '[]'::"jsonb",
    "category" "text" DEFAULT 'Product'::"text",
    "last_modified" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."newsletter_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paystack_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "test_secret_key" "text",
    "test_public_key" "text",
    "live_secret_key" "text",
    "live_public_key" "text",
    "is_live_mode" boolean DEFAULT false,
    "webhook_secret" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."paystack_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pending_registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "station_name" "text" NOT NULL,
    "county" "text",
    "notes" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "text",
    "reviewed_at" timestamp without time zone,
    "review_notes" "text",
    "approved_auth_user_id" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "tanks" "jsonb" DEFAULT '[]'::"jsonb",
    "email_verified" boolean DEFAULT false,
    "email_verified_at" timestamp without time zone,
    "verification_token" character varying(255),
    "verification_token_expires" timestamp without time zone,
    "approval_email_sent" boolean DEFAULT false,
    "approval_email_sent_at" timestamp without time zone,
    "recaptcha_token" "text",
    "approved_at" timestamp without time zone,
    "approved_station_id" "uuid",
    CONSTRAINT "chk_pending_email_format" CHECK (("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text")),
    CONSTRAINT "pending_registrations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'contacted'::"text"])))
);


ALTER TABLE "public"."pending_registrations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pending_registrations"."tanks" IS 'Stores an array of tank objects: [{name: string, type: string, capacity: number}]';



COMMENT ON COLUMN "public"."pending_registrations"."email_verified" IS 'Whether the applicant has verified their email address';



COMMENT ON COLUMN "public"."pending_registrations"."verification_token" IS 'One-time token sent to email for verification';



COMMENT ON COLUMN "public"."pending_registrations"."approval_email_sent" IS 'Whether approval notification email was sent';



COMMENT ON COLUMN "public"."pending_registrations"."recaptcha_token" IS 'reCAPTCHA v3 token for backend verification';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "station_id" "uuid",
    "email" "text" NOT NULL,
    "display_name" "text",
    "role" "text" DEFAULT 'operator'::"text",
    "site_ids" "text"[] DEFAULT '{}'::"text"[],
    "mfa_enabled" boolean DEFAULT false,
    "master_access_password" "text",
    "last_login_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "photo_url" "text",
    "auth_user_id" "uuid" NOT NULL,
    "security_pin_hash" "text",
    "security_pin_enabled" boolean DEFAULT false,
    "last_pin_change_at" timestamp with time zone,
    CONSTRAINT "chk_valid_role" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'supervisor'::"text", 'operator'::"text", 'viewer'::"text"]))),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'supervisor'::"text", 'operator'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Standardized User Profiles. auth_user_id is the source of truth.';



COMMENT ON COLUMN "public"."profiles"."security_pin_hash" IS 'Hashed 6-digit PIN for secondary security layer.';



COMMENT ON COLUMN "public"."profiles"."security_pin_enabled" IS 'Flag indicating if the user has configured their security PIN.';



CREATE TABLE IF NOT EXISTS "public"."raw_market_data" (
    "id" "text" NOT NULL,
    "station_id" "uuid",
    "fuel_type" "text",
    "region" "text",
    "price_per_liter" numeric(10,4),
    "currency" "text",
    "timestamp" bigint,
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."raw_market_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regulatory_notices" (
    "id" "text" NOT NULL,
    "station_id" "uuid",
    "authority" "text",
    "notice_type" "text",
    "title" "text" NOT NULL,
    "effective_date" bigint,
    "summary" "text",
    "document_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."regulatory_notices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "delivery_id" "uuid",
    "name" "text" NOT NULL,
    "report_type" "text" DEFAULT 'delivery_verification'::"text" NOT NULL,
    "report_data" "jsonb" NOT NULL,
    "generated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rss_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "feed_url" "text" NOT NULL,
    "content" "jsonb" NOT NULL,
    "cached_at" timestamp with time zone DEFAULT "now"(),
    "fetch_count" integer DEFAULT 0,
    "last_error" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."rss_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scraper_rate_limits" (
    "domain" "text" NOT NULL,
    "last_scrape_at" timestamp with time zone DEFAULT "now"(),
    "scrape_count" integer DEFAULT 0,
    "last_error" "text"
);


ALTER TABLE "public"."scraper_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sensor_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid" NOT NULL,
    "tank_id" "uuid" NOT NULL,
    "volume" double precision,
    "volume_corrected" double precision,
    "temperature" double precision,
    "water_level" double precision,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
)
PARTITION BY RANGE ("captured_at");


ALTER TABLE "public"."sensor_readings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sensor_readings_default" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid" NOT NULL,
    "tank_id" "uuid" NOT NULL,
    "volume" double precision,
    "volume_corrected" double precision,
    "temperature" double precision,
    "water_level" double precision,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."sensor_readings_default" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sensor_readings_y2026m05" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid" NOT NULL,
    "tank_id" "uuid" NOT NULL,
    "volume" double precision,
    "volume_corrected" double precision,
    "temperature" double precision,
    "water_level" double precision,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."sensor_readings_y2026m05" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sensor_readings_y2026m06" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid" NOT NULL,
    "tank_id" "uuid" NOT NULL,
    "volume" double precision,
    "volume_corrected" double precision,
    "temperature" double precision,
    "water_level" double precision,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."sensor_readings_y2026m06" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sensor_readings_y2026m07" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid" NOT NULL,
    "tank_id" "uuid" NOT NULL,
    "volume" double precision,
    "volume_corrected" double precision,
    "temperature" double precision,
    "water_level" double precision,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."sensor_readings_y2026m07" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_closures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "site_id" "uuid",
    "tank_id" "uuid",
    "opened_at" timestamp with time zone NOT NULL,
    "closed_at" timestamp with time zone NOT NULL,
    "duration_min" integer NOT NULL,
    "pump_readings" "jsonb" NOT NULL,
    "volume_sold_liters" numeric(10,2) NOT NULL,
    "expected_collections" "jsonb",
    "received_collections" "jsonb",
    "variance_data" "jsonb",
    "status" "text",
    "review_state" "text" DEFAULT 'PENDING'::"text",
    "supervisor_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "supabase_uid" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "operation_type" "text" DEFAULT 'CLOSE'::"text",
    "action_label" "text",
    "auth_user_id" "uuid",
    "is_manual_override" boolean DEFAULT false,
    "manual_override_reason" "text",
    CONSTRAINT "shift_closures_operation_type_check" CHECK (("operation_type" = ANY (ARRAY['OPEN'::"text", 'CLOSE'::"text"]))),
    CONSTRAINT "shift_closures_review_state_check" CHECK (("review_state" = ANY (ARRAY['OPEN'::"text", 'PENDING'::"text", 'APPROVED'::"text", 'DISPUTED'::"text", 'CLOSED'::"text", 'NEEDS_REVIEW'::"text"]))),
    CONSTRAINT "shift_closures_status_check" CHECK (("status" = ANY (ARRAY['BALANCED'::"text", 'OVER'::"text", 'SHORT'::"text", 'NEEDS_REVIEW'::"text"])))
);


ALTER TABLE "public"."shift_closures" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shift_closures"."metadata" IS 'Detailed forensic data including override history and AI-driven variance analysis.';



CREATE TABLE IF NOT EXISTS "public"."sites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "site_name" "text" NOT NULL,
    "address" "text",
    "latitude" double precision,
    "longitude" double precision,
    "tank_count" integer DEFAULT 0,
    "manager_name" "text",
    "contact_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "auth_user_id" "uuid"
);


ALTER TABLE "public"."sites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supply_risks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" NOT NULL,
    "source_url" "text",
    "type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "affected_regions" "text"[],
    "confidence" numeric(3,2),
    "source_type" "text",
    "attribution" "text",
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "supply_risks_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."supply_risks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "default_priority" "text" DEFAULT 'medium'::"text",
    "sla_hours" integer DEFAULT 24,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "support_categories_default_priority_check" CHECK (("default_priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'urgent'::"text"])))
);


ALTER TABLE "public"."support_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "subject" "text" NOT NULL,
    "description" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "support_tickets_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "support_tickets_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'resolved'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."support_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "target_admin_id" "uuid",
    "category" "text" DEFAULT 'system'::"text",
    "priority" "text" DEFAULT 'info'::"text",
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "system_notifications_category_check" CHECK (("category" = ANY (ARRAY['system'::"text", 'security'::"text", 'sla'::"text", 'billing'::"text"]))),
    CONSTRAINT "system_notifications_priority_check" CHECK (("priority" = ANY (ARRAY['info'::"text", 'warning'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."system_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "priority" "text" DEFAULT 'medium'::"text",
    "status" "text" DEFAULT 'backlog'::"text",
    "assignee" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "system_tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "system_tasks_status_check" CHECK (("status" = ANY (ARRAY['backlog'::"text", 'in_progress'::"text", 'review'::"text", 'testing'::"text", 'ready'::"text", 'deployed'::"text"])))
);


ALTER TABLE "public"."system_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "auth_user_id" "uuid",
    "photo_url" "text",
    "security_pin_enabled" boolean DEFAULT false,
    CONSTRAINT "chk_super_admin_requires_supabase_uid" CHECK ((("role" <> 'super_admin'::"text") OR ("auth_user_id" IS NOT NULL))),
    CONSTRAINT "chk_system_user_email_format" CHECK (("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text")),
    CONSTRAINT "chk_valid_system_role" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'admin_helper'::"text", 'support_staff'::"text", 'analyst'::"text"]))),
    CONSTRAINT "system_users_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'admin_helper'::"text", 'support_staff'::"text", 'analyst'::"text"])))
);


ALTER TABLE "public"."system_users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."system_users"."photo_url" IS 'Stores the public URL of the system administrator profile photo.';



CREATE MATERIALIZED VIEW "public"."tank_analytics_30d" AS
 SELECT "tank_id",
    "station_id",
    "avg"("volume") AS "avg_volume",
    "min"("volume") AS "min_volume",
    "max"("volume") AS "max_volume",
    "avg"("temperature") AS "avg_temperature",
    "count"(*) AS "reading_count",
    "now"() AS "last_calculated_at"
   FROM "public"."sensor_readings_legacy"
  WHERE ("timestamp" > ("now"() - '30 days'::interval))
  GROUP BY "tank_id", "station_id"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."tank_analytics_30d" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tanks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "site_id" "uuid",
    "tank_name" "text" NOT NULL,
    "tank_code" "text",
    "tank_shape" "text",
    "tank_capacity" numeric(10,2) NOT NULL,
    "tank_radius" numeric(10,2),
    "tank_length" numeric(10,2),
    "tank_height" numeric(10,2),
    "fuel_type" "text",
    "fuel_density" numeric(6,4),
    "molar_mass" numeric(6,4),
    "sensor_id" "text",
    "sensor_type" "text" DEFAULT 'A02YYUW'::"text",
    "sensor_offset" numeric(10,2) DEFAULT 0,
    "last_calibration_date" "date",
    "calibration_due_date" "date",
    "current_volume" numeric(10,2) DEFAULT 0,
    "current_temperature" numeric(5,2),
    "standard_volume" numeric(10,2),
    "last_reading_at" timestamp without time zone,
    "low_level_threshold" numeric(10,2) DEFAULT 500,
    "high_temperature_threshold" numeric(5,2) DEFAULT 60,
    "leak_detection_enabled" boolean DEFAULT true,
    "theft_detection_enabled" boolean DEFAULT true,
    "status" "text" DEFAULT 'active'::"text",
    "latitude" numeric(10,8),
    "longitude" numeric(11,8),
    "physical_location" "text",
    "installation_date" "date",
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "auth_user_id" "uuid",
    "sensor_empty_distance" numeric(10,2) DEFAULT NULL::numeric,
    "sensor_full_distance" numeric(10,2) DEFAULT NULL::numeric,
    "sensor_height" numeric(10,2) DEFAULT NULL::numeric,
    "sensor_channel" integer DEFAULT 1,
    "supabase_uid" "uuid",
    "last_smoothed_level" numeric(10,2),
    "filter_covariance" numeric(10,6) DEFAULT 1.0,
    "outlier_count" integer DEFAULT 0,
    CONSTRAINT "check_tank_dimensions" CHECK ((("tank_capacity" >= (0)::numeric) AND ("tank_height" >= (0)::numeric))),
    CONSTRAINT "check_tank_volume_bounds" CHECK ((("current_volume" >= (0)::numeric) AND ("current_volume" <= "tank_capacity"))),
    CONSTRAINT "check_tank_volume_non_negative" CHECK (("current_volume" >= (0)::numeric)),
    CONSTRAINT "chk_tank_capacity_positive" CHECK (("tank_capacity" > (0)::numeric)),
    CONSTRAINT "tanks_fuel_type_check" CHECK (("fuel_type" = ANY (ARRAY['Diesel'::"text", 'Petrol'::"text", 'Kerosene'::"text", 'Jet Fuel'::"text", 'LPG'::"text"]))),
    CONSTRAINT "tanks_sensor_channel_check" CHECK ((("sensor_channel" >= 1) AND ("sensor_channel" <= 4))),
    CONSTRAINT "tanks_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'maintenance'::"text", 'decommissioned'::"text", 'idle'::"text", 'pumping'::"text", 'offline'::"text"]))),
    CONSTRAINT "tanks_tank_capacity_check" CHECK (("tank_capacity" > (0)::numeric)),
    CONSTRAINT "tanks_tank_shape_check" CHECK (("tank_shape" = ANY (ARRAY['horizontal_cylinder'::"text", 'vertical_cylinder'::"text", 'rectangular'::"text", 'capsule'::"text"])))
);

ALTER TABLE ONLY "public"."tanks" REPLICA IDENTITY FULL;


ALTER TABLE "public"."tanks" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tanks"."sensor_empty_distance" IS 'Distance (cm) echoed by the ultrasonic sensor when the tank is completely empty. Used for level calibration.';



COMMENT ON COLUMN "public"."tanks"."sensor_full_distance" IS 'Distance (cm) echoed by the ultrasonic sensor when the tank is completely full. Used for level calibration.';



COMMENT ON COLUMN "public"."tanks"."sensor_height" IS 'Distance (cm) measured from the face of the ultrasonic sensor to the physical bottom of the tank.';



COMMENT ON COLUMN "public"."tanks"."sensor_channel" IS 'Identifies which ESP channel (1-4) this tank is connected to.';



CREATE TABLE IF NOT EXISTS "public"."team_member_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "station_name" "text",
    "full_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "auth_user_id" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "team_member_requests_role_check" CHECK (("role" = ANY (ARRAY['supervisor'::"text", 'operator'::"text", 'viewer'::"text"]))),
    CONSTRAINT "team_member_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."team_member_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telemetry_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "device_id" "uuid",
    "cpu_usage" smallint,
    "ram_usage" smallint,
    "temp" numeric(5,2),
    "voltage" numeric(4,2),
    "rssi" smallint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "station_id" "uuid"
);


ALTER TABLE "public"."telemetry_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid",
    "sender_id" "uuid",
    "sender_role" "text",
    "content" "text" NOT NULL,
    "is_internal" boolean DEFAULT false,
    "attachments" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sender_name" "text",
    CONSTRAINT "ticket_messages_sender_role_check" CHECK (("sender_role" = ANY (ARRAY['admin'::"text", 'client'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."ticket_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "transaction_type" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'KES'::"text",
    "payment_method" "text",
    "payment_reference" "text",
    "payment_status" "text" DEFAULT 'completed'::"text",
    "description" "text" NOT NULL,
    "admin_notes" "text",
    "invoice_number" "text",
    "receipt_url" "text",
    "reverses_transaction_id" "uuid",
    "reversed_by_transaction_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "completed_at" timestamp without time zone,
    "ip_address" "inet",
    "user_agent" "text",
    "auth_user_id" "uuid",
    CONSTRAINT "chk_transaction_amount_positive" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "transactions_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['MPESA'::"text", 'PAYSTACK'::"text", 'CASH'::"text", 'BANK_TRANSFER'::"text", 'AIRTEL_MONEY'::"text"]))),
    CONSTRAINT "transactions_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text", 'reversed'::"text", 'disputed'::"text"]))),
    CONSTRAINT "transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['charge'::"text", 'usage_charge'::"text", 'payment'::"text", 'refund'::"text", 'adjustment'::"text", 'penalty'::"text", 'discount'::"text", 'credit'::"text"])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'ORDER'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text", 'CALIBRATION'::"text"])))
)
PARTITION BY RANGE ("created_at");


ALTER TABLE "public"."unified_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events_2026_03" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'ORDER'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text", 'CALIBRATION'::"text"])))
);


ALTER TABLE "public"."unified_events_2026_03" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events_2026_04" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'ORDER'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text", 'CALIBRATION'::"text"])))
);


ALTER TABLE "public"."unified_events_2026_04" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events_2026_05" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'ORDER'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text", 'CALIBRATION'::"text"])))
);


ALTER TABLE "public"."unified_events_2026_05" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events_2026_06" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'ORDER'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text", 'CALIBRATION'::"text"])))
);


ALTER TABLE "public"."unified_events_2026_06" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events_2026_08" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'ORDER'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text", 'CALIBRATION'::"text"])))
);


ALTER TABLE "public"."unified_events_2026_08" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events_2026_09" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'ORDER'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text", 'CALIBRATION'::"text"])))
);


ALTER TABLE "public"."unified_events_2026_09" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events_2026_10" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'ORDER'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text", 'CALIBRATION'::"text"])))
);


ALTER TABLE "public"."unified_events_2026_10" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events_2026_11" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'ORDER'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text", 'CALIBRATION'::"text"])))
);


ALTER TABLE "public"."unified_events_2026_11" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unified_events_pre_partition" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "station_id" "uuid",
    "event_category" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "description" "text",
    "actor_id" "uuid",
    "actor_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "severity" "text" DEFAULT 'INFO'::"text",
    "is_resolved" boolean DEFAULT false,
    "actor_name" "text",
    CONSTRAINT "unified_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['SHIFT'::"text", 'DELIVERY'::"text", 'TEAM'::"text", 'SECURITY'::"text", 'SYSTEM'::"text", 'FINANCE'::"text", 'AI'::"text"]))),
    CONSTRAINT "unified_events_severity_check" CHECK (("severity" = ANY (ARRAY['INFO'::"text", 'WARNING'::"text", 'CRITICAL'::"text"])))
);


ALTER TABLE "public"."unified_events_pre_partition" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "preferences" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_push_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid",
    "token" "text" NOT NULL,
    "device_type" "text",
    "last_seen_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_push_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volume_lookup_tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tank_type" "text" NOT NULL,
    "dip_mm" integer NOT NULL,
    "volume_liters" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."volume_lookup_tables" OWNER TO "postgres";


ALTER TABLE ONLY "public"."sensor_readings" ATTACH PARTITION "public"."sensor_readings_default" DEFAULT;



ALTER TABLE ONLY "public"."sensor_readings" ATTACH PARTITION "public"."sensor_readings_y2026m05" FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');



ALTER TABLE ONLY "public"."sensor_readings" ATTACH PARTITION "public"."sensor_readings_y2026m06" FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');



ALTER TABLE ONLY "public"."sensor_readings" ATTACH PARTITION "public"."sensor_readings_y2026m07" FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');



ALTER TABLE ONLY "public"."unified_events" ATTACH PARTITION "public"."unified_events_2026_03" FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');



ALTER TABLE ONLY "public"."unified_events" ATTACH PARTITION "public"."unified_events_2026_04" FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');



ALTER TABLE ONLY "public"."unified_events" ATTACH PARTITION "public"."unified_events_2026_05" FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');



ALTER TABLE ONLY "public"."unified_events" ATTACH PARTITION "public"."unified_events_2026_06" FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');



ALTER TABLE ONLY "public"."unified_events" ATTACH PARTITION "public"."unified_events_2026_08" FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');



ALTER TABLE ONLY "public"."unified_events" ATTACH PARTITION "public"."unified_events_2026_09" FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');



ALTER TABLE ONLY "public"."unified_events" ATTACH PARTITION "public"."unified_events_2026_10" FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');



ALTER TABLE ONLY "public"."unified_events" ATTACH PARTITION "public"."unified_events_2026_11" FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');



ALTER TABLE ONLY "public"."ai_recommendations"
    ADD CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alerts"
    ADD CONSTRAINT "alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analysis_history"
    ADD CONSTRAINT "analysis_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auth_attempts"
    ADD CONSTRAINT "auth_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auth_events"
    ADD CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_paystack_customer_code_key" UNIQUE ("paystack_customer_code");



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_plans"
    ADD CONSTRAINT "billing_plans_paystack_plan_code_key" UNIQUE ("paystack_plan_code");



ALTER TABLE ONLY "public"."billing_plans"
    ADD CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_paystack_subscription_code_key" UNIQUE ("paystack_subscription_code");



ALTER TABLE ONLY "public"."billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_transactions"
    ADD CONSTRAINT "billing_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_transactions"
    ADD CONSTRAINT "billing_transactions_provider_ref_key" UNIQUE ("provider_ref");



ALTER TABLE ONLY "public"."canned_responses"
    ADD CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fuel_stations"
    ADD CONSTRAINT "client_billing_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."fuel_stations"
    ADD CONSTRAINT "client_billing_supabase_uid_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."current_station_shifts"
    ADD CONSTRAINT "current_station_shifts_pkey" PRIMARY KEY ("station_id");



ALTER TABLE ONLY "public"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_pkey" PRIMARY KEY ("tank_id", "date");



ALTER TABLE ONLY "public"."dashboard_banners"
    ADD CONSTRAINT "dashboard_banners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_commands"
    ADD CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_tokens"
    ADD CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_tokens"
    ADD CONSTRAINT "device_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_device_id_key" UNIQUE ("device_id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."edge_rate_limits"
    ADD CONSTRAINT "edge_rate_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."edge_rate_limits"
    ADD CONSTRAINT "edge_rate_limits_unique_window" UNIQUE ("scope_key", "endpoint", "window_starts_at");



ALTER TABLE ONLY "public"."file_uploads"
    ADD CONSTRAINT "file_uploads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."firmware_campaigns"
    ADD CONSTRAINT "firmware_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fuel_stations"
    ADD CONSTRAINT "fuel_stations_pkey" PRIMARY KEY ("station_id");



ALTER TABLE ONLY "public"."fuel_transactions"
    ADD CONSTRAINT "fuel_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."global_announcements"
    ADD CONSTRAINT "global_announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."internal_api_keys"
    ADD CONSTRAINT "internal_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."knowledge_base"
    ADD CONSTRAINT "knowledge_base_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loss_reviews"
    ADD CONSTRAINT "loss_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."market_action_queue"
    ADD CONSTRAINT "market_action_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."market_bookmarks"
    ADD CONSTRAINT "market_bookmarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."market_news"
    ADD CONSTRAINT "market_news_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."market_prices"
    ADD CONSTRAINT "market_prices_fuel_type_source_region_effective_date_key" UNIQUE ("fuel_type", "source", "region", "effective_date");



ALTER TABLE ONLY "public"."market_prices"
    ADD CONSTRAINT "market_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."market_signals"
    ADD CONSTRAINT "market_signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_leads"
    ADD CONSTRAINT "marketing_leads_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."marketing_leads"
    ADD CONSTRAINT "marketing_leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."newsletter_templates"
    ADD CONSTRAINT "newsletter_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."paystack_config"
    ADD CONSTRAINT "paystack_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."paystack_config"
    ADD CONSTRAINT "paystack_config_station_id_key" UNIQUE ("station_id");



ALTER TABLE ONLY "public"."pending_registrations"
    ADD CONSTRAINT "pending_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_registrations"
    ADD CONSTRAINT "pending_registrations_verification_token_key" UNIQUE ("verification_token");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("auth_user_id");



ALTER TABLE ONLY "public"."raw_market_data"
    ADD CONSTRAINT "raw_market_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regulatory_notices"
    ADD CONSTRAINT "regulatory_notices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rss_cache"
    ADD CONSTRAINT "rss_cache_feed_url_key" UNIQUE ("feed_url");



ALTER TABLE ONLY "public"."rss_cache"
    ADD CONSTRAINT "rss_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scraper_rate_limits"
    ADD CONSTRAINT "scraper_rate_limits_pkey" PRIMARY KEY ("domain");



ALTER TABLE ONLY "public"."security_telemetry_events"
    ADD CONSTRAINT "security_telemetry_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sensor_readings"
    ADD CONSTRAINT "sensor_readings_partitioned_pkey" PRIMARY KEY ("id", "captured_at");



ALTER TABLE ONLY "public"."sensor_readings_default"
    ADD CONSTRAINT "sensor_readings_default_pkey" PRIMARY KEY ("id", "captured_at");



ALTER TABLE ONLY "public"."sensor_readings_legacy"
    ADD CONSTRAINT "sensor_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sensor_readings_y2026m05"
    ADD CONSTRAINT "sensor_readings_y2026m05_pkey" PRIMARY KEY ("id", "captured_at");



ALTER TABLE ONLY "public"."sensor_readings_y2026m06"
    ADD CONSTRAINT "sensor_readings_y2026m06_pkey" PRIMARY KEY ("id", "captured_at");



ALTER TABLE ONLY "public"."sensor_readings_y2026m07"
    ADD CONSTRAINT "sensor_readings_y2026m07_pkey" PRIMARY KEY ("id", "captured_at");



ALTER TABLE ONLY "public"."shift_closures"
    ADD CONSTRAINT "shift_closures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_client_id_site_name_key" UNIQUE ("station_id", "site_name");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supply_risks"
    ADD CONSTRAINT "supply_risks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_categories"
    ADD CONSTRAINT "support_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."support_categories"
    ADD CONSTRAINT "support_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_notifications"
    ADD CONSTRAINT "system_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."system_tasks"
    ADD CONSTRAINT "system_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_users"
    ADD CONSTRAINT "system_users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."system_users"
    ADD CONSTRAINT "system_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tanks"
    ADD CONSTRAINT "tanks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_member_requests"
    ADD CONSTRAINT "team_member_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telemetry_history"
    ADD CONSTRAINT "telemetry_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unified_events"
    ADD CONSTRAINT "unified_events_pkey1" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."unified_events_2026_03"
    ADD CONSTRAINT "unified_events_2026_03_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."unified_events_2026_04"
    ADD CONSTRAINT "unified_events_2026_04_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."unified_events_2026_05"
    ADD CONSTRAINT "unified_events_2026_05_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."unified_events_2026_06"
    ADD CONSTRAINT "unified_events_2026_06_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."unified_events_2026_08"
    ADD CONSTRAINT "unified_events_2026_08_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."unified_events_2026_09"
    ADD CONSTRAINT "unified_events_2026_09_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."unified_events_2026_10"
    ADD CONSTRAINT "unified_events_2026_10_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."unified_events_2026_11"
    ADD CONSTRAINT "unified_events_2026_11_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."unified_events_pre_partition"
    ADD CONSTRAINT "unified_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_auth_user_id_token_key" UNIQUE ("auth_user_id", "token");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."volume_lookup_tables"
    ADD CONSTRAINT "volume_lookup_tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."volume_lookup_tables"
    ADD CONSTRAINT "volume_lookup_tables_tank_type_dip_mm_key" UNIQUE ("tank_type", "dip_mm");



CREATE INDEX "idx_ai_recs_client" ON "public"."ai_recommendations" USING "btree" ("station_id");



CREATE UNIQUE INDEX "idx_alerts_active_dedupe" ON "public"."alerts" USING "btree" ("station_id", "tank_id", "alert_type") WHERE ("is_resolved" = false);



CREATE INDEX "idx_alerts_auth_user_id" ON "public"."alerts" USING "btree" ("auth_user_id");



CREATE INDEX "idx_alerts_created_at" ON "public"."alerts" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_alerts_id" ON "public"."alerts" USING "btree" ("id");



CREATE INDEX "idx_alerts_is_resolved" ON "public"."alerts" USING "btree" ("is_resolved") WHERE ("is_resolved" = false);



CREATE INDEX "idx_alerts_station_id" ON "public"."alerts" USING "btree" ("station_id");



CREATE INDEX "idx_alerts_station_resolved" ON "public"."alerts" USING "btree" ("station_id", "is_resolved");



CREATE UNIQUE INDEX "idx_alerts_station_type_title_unique" ON "public"."alerts" USING "btree" ("station_id", "alert_type", "title");



CREATE INDEX "idx_alerts_supabase_uid_fk" ON "public"."alerts" USING "btree" ("supabase_uid");



CREATE INDEX "idx_alerts_tank" ON "public"."alerts" USING "btree" ("tank_id");



CREATE INDEX "idx_alerts_tank_id" ON "public"."alerts" USING "btree" ("tank_id");



CREATE UNIQUE INDEX "idx_alerts_unique_active" ON "public"."alerts" USING "btree" ("tank_id", "alert_type") WHERE ("is_resolved" = false);



CREATE INDEX "idx_alerts_unread" ON "public"."alerts" USING "btree" ("station_id", "is_read") WHERE ("is_read" = false);



CREATE INDEX "idx_alerts_unresolved" ON "public"."alerts" USING "btree" ("station_id", "is_resolved") WHERE ("is_resolved" = false);



CREATE INDEX "idx_analysis_history_file_id_covering" ON "public"."analysis_history" USING "btree" ("file_id");



CREATE INDEX "idx_analysis_history_station_id_covering" ON "public"."analysis_history" USING "btree" ("station_id");



CREATE INDEX "idx_audit_logs_client" ON "public"."audit_logs" USING "btree" ("station_id");



CREATE INDEX "idx_auth_attempts_email_time" ON "public"."auth_attempts" USING "btree" ("email", "attempted_at" DESC);



CREATE INDEX "idx_auth_events_user_id" ON "public"."auth_events" USING "btree" ("user_id");



CREATE INDEX "idx_billing_customers_station_id_covering" ON "public"."billing_customers" USING "btree" ("station_id");



CREATE INDEX "idx_billing_plans_station_id_covering" ON "public"."billing_plans" USING "btree" ("station_id");



CREATE INDEX "idx_billing_subscriptions_customer_id_covering" ON "public"."billing_subscriptions" USING "btree" ("customer_id");



CREATE INDEX "idx_billing_subscriptions_plan_id_covering" ON "public"."billing_subscriptions" USING "btree" ("plan_id");



CREATE INDEX "idx_billing_subscriptions_station_id_covering" ON "public"."billing_subscriptions" USING "btree" ("station_id");



CREATE INDEX "idx_billing_transactions_station_id" ON "public"."billing_transactions" USING "btree" ("station_id");



CREATE INDEX "idx_current_station_shifts_updated_by_covering" ON "public"."current_station_shifts" USING "btree" ("updated_by");



CREATE INDEX "idx_dashboard_banners_created_by" ON "public"."dashboard_banners" USING "btree" ("created_by");



CREATE INDEX "idx_deliveries_auth_user_id" ON "public"."deliveries" USING "btree" ("auth_user_id");



CREATE INDEX "idx_deliveries_client" ON "public"."deliveries" USING "btree" ("station_id");



CREATE INDEX "idx_deliveries_date" ON "public"."deliveries" USING "btree" ("delivery_date" DESC);



CREATE INDEX "idx_deliveries_tank" ON "public"."deliveries" USING "btree" ("tank_id");



CREATE INDEX "idx_deliveries_tank_id_covering" ON "public"."deliveries" USING "btree" ("tank_id");



CREATE INDEX "idx_device_commands_station" ON "public"."device_commands" USING "btree" ("station_id");



CREATE INDEX "idx_device_tokens_issued_by" ON "public"."device_tokens" USING "btree" ("issued_by");



CREATE INDEX "idx_device_tokens_revoked_by" ON "public"."device_tokens" USING "btree" ("revoked_by");



CREATE INDEX "idx_device_tokens_tank_id_covering" ON "public"."device_tokens" USING "btree" ("tank_id");



CREATE INDEX "idx_devices_station_id_covering" ON "public"."devices" USING "btree" ("station_id");



CREATE INDEX "idx_file_uploads_client" ON "public"."file_uploads" USING "btree" ("station_id");



CREATE INDEX "idx_firmware_campaigns_created_by" ON "public"."firmware_campaigns" USING "btree" ("created_by");



CREATE INDEX "idx_fuel_stations_auth_user_id_covering" ON "public"."fuel_stations" USING "btree" ("auth_user_id");



CREATE INDEX "idx_fuel_stations_owner_id_covering" ON "public"."fuel_stations" USING "btree" ("owner_id");



CREATE INDEX "idx_fuel_stations_supabase_uid_covering" ON "public"."fuel_stations" USING "btree" ("supabase_uid");



CREATE INDEX "idx_fuel_transactions_station_id" ON "public"."fuel_transactions" USING "btree" ("station_id");



CREATE INDEX "idx_fuel_transactions_tank_id" ON "public"."fuel_transactions" USING "btree" ("tank_id");



CREATE INDEX "idx_global_announcements_created_by" ON "public"."global_announcements" USING "btree" ("created_by");



CREATE INDEX "idx_internal_api_keys_station_id_covering" ON "public"."internal_api_keys" USING "btree" ("station_id");



CREATE INDEX "idx_invoices_station_id_covering" ON "public"."invoices" USING "btree" ("station_id");



CREATE INDEX "idx_loss_reviews_reviewed_by_covering" ON "public"."loss_reviews" USING "btree" ("reviewed_by");



CREATE INDEX "idx_market_action_queue_station_id" ON "public"."market_action_queue" USING "btree" ("station_id");



CREATE INDEX "idx_market_action_queue_station_id_covering" ON "public"."market_action_queue" USING "btree" ("station_id");



CREATE INDEX "idx_market_action_queue_status" ON "public"."market_action_queue" USING "btree" ("status");



CREATE INDEX "idx_market_bookmarks_client_id" ON "public"."market_bookmarks" USING "btree" ("station_id");



CREATE INDEX "idx_market_bookmarks_client_id_fk" ON "public"."market_bookmarks" USING "btree" ("station_id");



CREATE INDEX "idx_market_bookmarks_station_id_covering" ON "public"."market_bookmarks" USING "btree" ("station_id");



CREATE INDEX "idx_market_news_created_by" ON "public"."market_news" USING "btree" ("created_by");



CREATE INDEX "idx_market_prices_date" ON "public"."market_prices" USING "btree" ("effective_date" DESC);



CREATE INDEX "idx_market_prices_fuel" ON "public"."market_prices" USING "btree" ("fuel_type");



CREATE INDEX "idx_market_signals_client" ON "public"."market_signals" USING "btree" ("station_id");



CREATE INDEX "idx_market_signals_time" ON "public"."market_signals" USING "btree" ("timestamp" DESC);



CREATE INDEX "idx_newsletter_templates_created_by" ON "public"."newsletter_templates" USING "btree" ("created_by");



CREATE INDEX "idx_pending_reg_email" ON "public"."pending_registrations" USING "btree" ("email");



CREATE INDEX "idx_pending_reg_status" ON "public"."pending_registrations" USING "btree" ("status");



CREATE INDEX "idx_pending_registrations_approved_station_id_covering" ON "public"."pending_registrations" USING "btree" ("approved_station_id");



CREATE INDEX "idx_profiles_auth_user_id" ON "public"."profiles" USING "btree" ("auth_user_id");



CREATE INDEX "idx_profiles_auth_user_id_station" ON "public"."profiles" USING "btree" ("auth_user_id", "station_id");



CREATE INDEX "idx_profiles_station_id" ON "public"."profiles" USING "btree" ("station_id");



CREATE INDEX "idx_profiles_station_id_covering" ON "public"."profiles" USING "btree" ("station_id");



CREATE INDEX "idx_raw_market_data_client" ON "public"."raw_market_data" USING "btree" ("station_id");



CREATE INDEX "idx_readings_timestamp" ON "public"."sensor_readings_legacy" USING "btree" ("timestamp" DESC);



CREATE INDEX "idx_reports_delivery_id_covering" ON "public"."reports" USING "btree" ("delivery_id");



CREATE INDEX "idx_reports_generated_by_covering" ON "public"."reports" USING "btree" ("generated_by");



CREATE INDEX "idx_reports_station" ON "public"."reports" USING "btree" ("station_id");



CREATE INDEX "idx_requlatory_notices_client" ON "public"."regulatory_notices" USING "btree" ("station_id");



CREATE INDEX "idx_rss_cache_url" ON "public"."rss_cache" USING "btree" ("feed_url");



CREATE INDEX "idx_security_telemetry_events_created_at" ON "public"."security_telemetry_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_sensor_readings_legacy_station_id" ON "public"."sensor_readings_legacy" USING "btree" ("station_id");



CREATE INDEX "idx_sensor_readings_legacy_station_id_covering" ON "public"."sensor_readings_legacy" USING "btree" ("station_id");



CREATE INDEX "idx_sensor_readings_legacy_supabase_uid" ON "public"."sensor_readings_legacy" USING "btree" ("supabase_uid");



CREATE INDEX "idx_sensor_readings_station_id" ON ONLY "public"."sensor_readings" USING "btree" ("station_id");



CREATE INDEX "idx_sensor_readings_tank_captured" ON ONLY "public"."sensor_readings" USING "btree" ("tank_id", "captured_at" DESC);



CREATE INDEX "idx_sensor_readings_tank_id" ON ONLY "public"."sensor_readings" USING "btree" ("tank_id");



CREATE INDEX "idx_sensor_readings_tank_id_timestamp" ON "public"."sensor_readings_legacy" USING "btree" ("tank_id", "timestamp" DESC);



CREATE INDEX "idx_shift_closures_auth_user_id" ON "public"."shift_closures" USING "btree" ("auth_user_id");



CREATE INDEX "idx_shift_closures_auth_user_id_covering" ON "public"."shift_closures" USING "btree" ("auth_user_id");



CREATE INDEX "idx_shift_closures_client" ON "public"."shift_closures" USING "btree" ("station_id");



CREATE INDEX "idx_shift_closures_date" ON "public"."shift_closures" USING "btree" ("closed_at" DESC);



CREATE INDEX "idx_shift_closures_site_id_covering" ON "public"."shift_closures" USING "btree" ("site_id");



CREATE INDEX "idx_shift_closures_supabase_uid_covering" ON "public"."shift_closures" USING "btree" ("supabase_uid");



CREATE INDEX "idx_shift_closures_tank" ON "public"."shift_closures" USING "btree" ("tank_id");



CREATE INDEX "idx_sites_auth_user_id_covering" ON "public"."sites" USING "btree" ("auth_user_id");



CREATE INDEX "idx_supply_risks_timestamp" ON "public"."supply_risks" USING "btree" ("timestamp" DESC);



CREATE INDEX "idx_support_tickets_station_id_covering" ON "public"."support_tickets" USING "btree" ("station_id");



CREATE INDEX "idx_system_notifications_target_admin_id" ON "public"."system_notifications" USING "btree" ("target_admin_id");



CREATE INDEX "idx_system_users_auth_user_id" ON "public"."system_users" USING "btree" ("auth_user_id");



CREATE INDEX "idx_system_users_auth_user_id_covering" ON "public"."system_users" USING "btree" ("auth_user_id");



CREATE INDEX "idx_system_users_created_by_covering" ON "public"."system_users" USING "btree" ("created_by");



CREATE INDEX "idx_tanks_auth_user_id" ON "public"."tanks" USING "btree" ("auth_user_id");



CREATE INDEX "idx_tanks_auth_user_id_covering" ON "public"."tanks" USING "btree" ("auth_user_id");



CREATE UNIQUE INDEX "idx_tanks_sensor_channel_unique" ON "public"."tanks" USING "btree" ("sensor_id", "sensor_channel");



CREATE INDEX "idx_tanks_site_id_covering" ON "public"."tanks" USING "btree" ("site_id");



CREATE INDEX "idx_tanks_station_id" ON "public"."tanks" USING "btree" ("station_id");



CREATE INDEX "idx_tanks_station_id_covering" ON "public"."tanks" USING "btree" ("station_id");



CREATE INDEX "idx_tanks_supabase_uid_covering" ON "public"."tanks" USING "btree" ("supabase_uid");



CREATE INDEX "idx_telemetry_history_device_id_covering" ON "public"."telemetry_history" USING "btree" ("device_id");



CREATE INDEX "idx_telemetry_history_station_id_covering" ON "public"."telemetry_history" USING "btree" ("station_id");



CREATE INDEX "idx_ticket_messages_sender_id" ON "public"."ticket_messages" USING "btree" ("sender_id");



CREATE INDEX "idx_ticket_messages_ticket_id_covering" ON "public"."ticket_messages" USING "btree" ("ticket_id");



CREATE INDEX "idx_tmr_station_id" ON "public"."team_member_requests" USING "btree" ("station_id");



CREATE INDEX "idx_transactions_auth_user_id" ON "public"."transactions" USING "btree" ("auth_user_id");



CREATE INDEX "idx_transactions_auth_user_id_covering" ON "public"."transactions" USING "btree" ("auth_user_id");



CREATE INDEX "idx_transactions_client" ON "public"."transactions" USING "btree" ("station_id");



CREATE INDEX "idx_transactions_date" ON "public"."transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_transactions_reversed_by_transaction_id_covering" ON "public"."transactions" USING "btree" ("reversed_by_transaction_id");



CREATE INDEX "idx_transactions_reverses_transaction_id_covering" ON "public"."transactions" USING "btree" ("reverses_transaction_id");



CREATE INDEX "idx_transactions_station_time" ON "public"."transactions" USING "btree" ("station_id", "created_at" DESC);



CREATE INDEX "idx_transactions_type" ON "public"."transactions" USING "btree" ("transaction_type");



CREATE INDEX "idx_unified_events_actor_id" ON ONLY "public"."unified_events" USING "btree" ("actor_id");



CREATE INDEX "idx_unified_events_created_at" ON ONLY "public"."unified_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_unified_events_id" ON ONLY "public"."unified_events" USING "btree" ("id");



CREATE INDEX "idx_unified_events_is_resolved" ON ONLY "public"."unified_events" USING "btree" ("is_resolved");



CREATE INDEX "idx_unified_events_pre_partition_actor" ON "public"."unified_events_pre_partition" USING "btree" ("actor_id");



CREATE INDEX "idx_unified_events_station_category" ON ONLY "public"."unified_events" USING "btree" ("station_id", "event_category");



CREATE INDEX "idx_unified_events_station_id" ON ONLY "public"."unified_events" USING "btree" ("station_id");



CREATE INDEX "idx_unified_events_station_resolved" ON "public"."unified_events_pre_partition" USING "btree" ("station_id", "is_resolved", "created_at" DESC);



CREATE INDEX "sensor_readings_default_station_id_idx" ON "public"."sensor_readings_default" USING "btree" ("station_id");



CREATE INDEX "sensor_readings_default_tank_id_captured_at_idx" ON "public"."sensor_readings_default" USING "btree" ("tank_id", "captured_at" DESC);



CREATE INDEX "sensor_readings_default_tank_id_idx" ON "public"."sensor_readings_default" USING "btree" ("tank_id");



CREATE INDEX "sensor_readings_y2026m05_station_id_idx" ON "public"."sensor_readings_y2026m05" USING "btree" ("station_id");



CREATE INDEX "sensor_readings_y2026m05_tank_id_captured_at_idx" ON "public"."sensor_readings_y2026m05" USING "btree" ("tank_id", "captured_at" DESC);



CREATE INDEX "sensor_readings_y2026m05_tank_id_idx" ON "public"."sensor_readings_y2026m05" USING "btree" ("tank_id");



CREATE INDEX "sensor_readings_y2026m06_station_id_idx" ON "public"."sensor_readings_y2026m06" USING "btree" ("station_id");



CREATE INDEX "sensor_readings_y2026m06_tank_id_captured_at_idx" ON "public"."sensor_readings_y2026m06" USING "btree" ("tank_id", "captured_at" DESC);



CREATE INDEX "sensor_readings_y2026m06_tank_id_idx" ON "public"."sensor_readings_y2026m06" USING "btree" ("tank_id");



CREATE INDEX "sensor_readings_y2026m07_station_id_idx" ON "public"."sensor_readings_y2026m07" USING "btree" ("station_id");



CREATE INDEX "sensor_readings_y2026m07_tank_id_captured_at_idx" ON "public"."sensor_readings_y2026m07" USING "btree" ("tank_id", "captured_at" DESC);



CREATE INDEX "sensor_readings_y2026m07_tank_id_idx" ON "public"."sensor_readings_y2026m07" USING "btree" ("tank_id");



CREATE INDEX "unified_events_2026_03_actor_id_idx" ON "public"."unified_events_2026_03" USING "btree" ("actor_id");



CREATE INDEX "unified_events_2026_03_created_at_idx" ON "public"."unified_events_2026_03" USING "btree" ("created_at" DESC);



CREATE INDEX "unified_events_2026_03_id_idx" ON "public"."unified_events_2026_03" USING "btree" ("id");



CREATE INDEX "unified_events_2026_03_is_resolved_idx" ON "public"."unified_events_2026_03" USING "btree" ("is_resolved");



CREATE INDEX "unified_events_2026_03_station_id_event_category_idx" ON "public"."unified_events_2026_03" USING "btree" ("station_id", "event_category");



CREATE INDEX "unified_events_2026_03_station_id_idx" ON "public"."unified_events_2026_03" USING "btree" ("station_id");



CREATE INDEX "unified_events_2026_04_actor_id_idx" ON "public"."unified_events_2026_04" USING "btree" ("actor_id");



CREATE INDEX "unified_events_2026_04_created_at_idx" ON "public"."unified_events_2026_04" USING "btree" ("created_at" DESC);



CREATE INDEX "unified_events_2026_04_id_idx" ON "public"."unified_events_2026_04" USING "btree" ("id");



CREATE INDEX "unified_events_2026_04_is_resolved_idx" ON "public"."unified_events_2026_04" USING "btree" ("is_resolved");



CREATE INDEX "unified_events_2026_04_station_id_event_category_idx" ON "public"."unified_events_2026_04" USING "btree" ("station_id", "event_category");



CREATE INDEX "unified_events_2026_04_station_id_idx" ON "public"."unified_events_2026_04" USING "btree" ("station_id");



CREATE INDEX "unified_events_2026_05_actor_id_idx" ON "public"."unified_events_2026_05" USING "btree" ("actor_id");



CREATE INDEX "unified_events_2026_05_created_at_idx" ON "public"."unified_events_2026_05" USING "btree" ("created_at" DESC);



CREATE INDEX "unified_events_2026_05_id_idx" ON "public"."unified_events_2026_05" USING "btree" ("id");



CREATE INDEX "unified_events_2026_05_is_resolved_idx" ON "public"."unified_events_2026_05" USING "btree" ("is_resolved");



CREATE INDEX "unified_events_2026_05_station_id_event_category_idx" ON "public"."unified_events_2026_05" USING "btree" ("station_id", "event_category");



CREATE INDEX "unified_events_2026_05_station_id_idx" ON "public"."unified_events_2026_05" USING "btree" ("station_id");



CREATE INDEX "unified_events_2026_06_actor_id_idx" ON "public"."unified_events_2026_06" USING "btree" ("actor_id");



CREATE INDEX "unified_events_2026_06_created_at_idx" ON "public"."unified_events_2026_06" USING "btree" ("created_at" DESC);



CREATE INDEX "unified_events_2026_06_id_idx" ON "public"."unified_events_2026_06" USING "btree" ("id");



CREATE INDEX "unified_events_2026_06_is_resolved_idx" ON "public"."unified_events_2026_06" USING "btree" ("is_resolved");



CREATE INDEX "unified_events_2026_06_station_id_event_category_idx" ON "public"."unified_events_2026_06" USING "btree" ("station_id", "event_category");



CREATE INDEX "unified_events_2026_06_station_id_idx" ON "public"."unified_events_2026_06" USING "btree" ("station_id");



CREATE INDEX "unified_events_2026_08_actor_id_idx" ON "public"."unified_events_2026_08" USING "btree" ("actor_id");



CREATE INDEX "unified_events_2026_08_created_at_idx" ON "public"."unified_events_2026_08" USING "btree" ("created_at" DESC);



CREATE INDEX "unified_events_2026_08_id_idx" ON "public"."unified_events_2026_08" USING "btree" ("id");



CREATE INDEX "unified_events_2026_08_is_resolved_idx" ON "public"."unified_events_2026_08" USING "btree" ("is_resolved");



CREATE INDEX "unified_events_2026_08_station_id_event_category_idx" ON "public"."unified_events_2026_08" USING "btree" ("station_id", "event_category");



CREATE INDEX "unified_events_2026_08_station_id_idx" ON "public"."unified_events_2026_08" USING "btree" ("station_id");



CREATE INDEX "unified_events_2026_09_actor_id_idx" ON "public"."unified_events_2026_09" USING "btree" ("actor_id");



CREATE INDEX "unified_events_2026_09_created_at_idx" ON "public"."unified_events_2026_09" USING "btree" ("created_at" DESC);



CREATE INDEX "unified_events_2026_09_id_idx" ON "public"."unified_events_2026_09" USING "btree" ("id");



CREATE INDEX "unified_events_2026_09_is_resolved_idx" ON "public"."unified_events_2026_09" USING "btree" ("is_resolved");



CREATE INDEX "unified_events_2026_09_station_id_event_category_idx" ON "public"."unified_events_2026_09" USING "btree" ("station_id", "event_category");



CREATE INDEX "unified_events_2026_09_station_id_idx" ON "public"."unified_events_2026_09" USING "btree" ("station_id");



CREATE INDEX "unified_events_2026_10_actor_id_idx" ON "public"."unified_events_2026_10" USING "btree" ("actor_id");



CREATE INDEX "unified_events_2026_10_created_at_idx" ON "public"."unified_events_2026_10" USING "btree" ("created_at" DESC);



CREATE INDEX "unified_events_2026_10_id_idx" ON "public"."unified_events_2026_10" USING "btree" ("id");



CREATE INDEX "unified_events_2026_10_is_resolved_idx" ON "public"."unified_events_2026_10" USING "btree" ("is_resolved");



CREATE INDEX "unified_events_2026_10_station_id_event_category_idx" ON "public"."unified_events_2026_10" USING "btree" ("station_id", "event_category");



CREATE INDEX "unified_events_2026_10_station_id_idx" ON "public"."unified_events_2026_10" USING "btree" ("station_id");



CREATE INDEX "unified_events_2026_11_actor_id_idx" ON "public"."unified_events_2026_11" USING "btree" ("actor_id");



CREATE INDEX "unified_events_2026_11_created_at_idx" ON "public"."unified_events_2026_11" USING "btree" ("created_at" DESC);



CREATE INDEX "unified_events_2026_11_id_idx" ON "public"."unified_events_2026_11" USING "btree" ("id");



CREATE INDEX "unified_events_2026_11_is_resolved_idx" ON "public"."unified_events_2026_11" USING "btree" ("is_resolved");



CREATE INDEX "unified_events_2026_11_station_id_event_category_idx" ON "public"."unified_events_2026_11" USING "btree" ("station_id", "event_category");



CREATE INDEX "unified_events_2026_11_station_id_idx" ON "public"."unified_events_2026_11" USING "btree" ("station_id");



CREATE UNIQUE INDEX "uq_system_users_active_super_admin" ON "public"."system_users" USING "btree" ("role") WHERE (("role" = 'super_admin'::"text") AND ("is_active" = true));



ALTER INDEX "public"."sensor_readings_partitioned_pkey" ATTACH PARTITION "public"."sensor_readings_default_pkey";



ALTER INDEX "public"."idx_sensor_readings_station_id" ATTACH PARTITION "public"."sensor_readings_default_station_id_idx";



ALTER INDEX "public"."idx_sensor_readings_tank_captured" ATTACH PARTITION "public"."sensor_readings_default_tank_id_captured_at_idx";



ALTER INDEX "public"."idx_sensor_readings_tank_id" ATTACH PARTITION "public"."sensor_readings_default_tank_id_idx";



ALTER INDEX "public"."sensor_readings_partitioned_pkey" ATTACH PARTITION "public"."sensor_readings_y2026m05_pkey";



ALTER INDEX "public"."idx_sensor_readings_station_id" ATTACH PARTITION "public"."sensor_readings_y2026m05_station_id_idx";



ALTER INDEX "public"."idx_sensor_readings_tank_captured" ATTACH PARTITION "public"."sensor_readings_y2026m05_tank_id_captured_at_idx";



ALTER INDEX "public"."idx_sensor_readings_tank_id" ATTACH PARTITION "public"."sensor_readings_y2026m05_tank_id_idx";



ALTER INDEX "public"."sensor_readings_partitioned_pkey" ATTACH PARTITION "public"."sensor_readings_y2026m06_pkey";



ALTER INDEX "public"."idx_sensor_readings_station_id" ATTACH PARTITION "public"."sensor_readings_y2026m06_station_id_idx";



ALTER INDEX "public"."idx_sensor_readings_tank_captured" ATTACH PARTITION "public"."sensor_readings_y2026m06_tank_id_captured_at_idx";



ALTER INDEX "public"."idx_sensor_readings_tank_id" ATTACH PARTITION "public"."sensor_readings_y2026m06_tank_id_idx";



ALTER INDEX "public"."sensor_readings_partitioned_pkey" ATTACH PARTITION "public"."sensor_readings_y2026m07_pkey";



ALTER INDEX "public"."idx_sensor_readings_station_id" ATTACH PARTITION "public"."sensor_readings_y2026m07_station_id_idx";



ALTER INDEX "public"."idx_sensor_readings_tank_captured" ATTACH PARTITION "public"."sensor_readings_y2026m07_tank_id_captured_at_idx";



ALTER INDEX "public"."idx_sensor_readings_tank_id" ATTACH PARTITION "public"."sensor_readings_y2026m07_tank_id_idx";



ALTER INDEX "public"."idx_unified_events_actor_id" ATTACH PARTITION "public"."unified_events_2026_03_actor_id_idx";



ALTER INDEX "public"."idx_unified_events_created_at" ATTACH PARTITION "public"."unified_events_2026_03_created_at_idx";



ALTER INDEX "public"."idx_unified_events_id" ATTACH PARTITION "public"."unified_events_2026_03_id_idx";



ALTER INDEX "public"."idx_unified_events_is_resolved" ATTACH PARTITION "public"."unified_events_2026_03_is_resolved_idx";



ALTER INDEX "public"."unified_events_pkey1" ATTACH PARTITION "public"."unified_events_2026_03_pkey";



ALTER INDEX "public"."idx_unified_events_station_category" ATTACH PARTITION "public"."unified_events_2026_03_station_id_event_category_idx";



ALTER INDEX "public"."idx_unified_events_station_id" ATTACH PARTITION "public"."unified_events_2026_03_station_id_idx";



ALTER INDEX "public"."idx_unified_events_actor_id" ATTACH PARTITION "public"."unified_events_2026_04_actor_id_idx";



ALTER INDEX "public"."idx_unified_events_created_at" ATTACH PARTITION "public"."unified_events_2026_04_created_at_idx";



ALTER INDEX "public"."idx_unified_events_id" ATTACH PARTITION "public"."unified_events_2026_04_id_idx";



ALTER INDEX "public"."idx_unified_events_is_resolved" ATTACH PARTITION "public"."unified_events_2026_04_is_resolved_idx";



ALTER INDEX "public"."unified_events_pkey1" ATTACH PARTITION "public"."unified_events_2026_04_pkey";



ALTER INDEX "public"."idx_unified_events_station_category" ATTACH PARTITION "public"."unified_events_2026_04_station_id_event_category_idx";



ALTER INDEX "public"."idx_unified_events_station_id" ATTACH PARTITION "public"."unified_events_2026_04_station_id_idx";



ALTER INDEX "public"."idx_unified_events_actor_id" ATTACH PARTITION "public"."unified_events_2026_05_actor_id_idx";



ALTER INDEX "public"."idx_unified_events_created_at" ATTACH PARTITION "public"."unified_events_2026_05_created_at_idx";



ALTER INDEX "public"."idx_unified_events_id" ATTACH PARTITION "public"."unified_events_2026_05_id_idx";



ALTER INDEX "public"."idx_unified_events_is_resolved" ATTACH PARTITION "public"."unified_events_2026_05_is_resolved_idx";



ALTER INDEX "public"."unified_events_pkey1" ATTACH PARTITION "public"."unified_events_2026_05_pkey";



ALTER INDEX "public"."idx_unified_events_station_category" ATTACH PARTITION "public"."unified_events_2026_05_station_id_event_category_idx";



ALTER INDEX "public"."idx_unified_events_station_id" ATTACH PARTITION "public"."unified_events_2026_05_station_id_idx";



ALTER INDEX "public"."idx_unified_events_actor_id" ATTACH PARTITION "public"."unified_events_2026_06_actor_id_idx";



ALTER INDEX "public"."idx_unified_events_created_at" ATTACH PARTITION "public"."unified_events_2026_06_created_at_idx";



ALTER INDEX "public"."idx_unified_events_id" ATTACH PARTITION "public"."unified_events_2026_06_id_idx";



ALTER INDEX "public"."idx_unified_events_is_resolved" ATTACH PARTITION "public"."unified_events_2026_06_is_resolved_idx";



ALTER INDEX "public"."unified_events_pkey1" ATTACH PARTITION "public"."unified_events_2026_06_pkey";



ALTER INDEX "public"."idx_unified_events_station_category" ATTACH PARTITION "public"."unified_events_2026_06_station_id_event_category_idx";



ALTER INDEX "public"."idx_unified_events_station_id" ATTACH PARTITION "public"."unified_events_2026_06_station_id_idx";



ALTER INDEX "public"."idx_unified_events_actor_id" ATTACH PARTITION "public"."unified_events_2026_08_actor_id_idx";



ALTER INDEX "public"."idx_unified_events_created_at" ATTACH PARTITION "public"."unified_events_2026_08_created_at_idx";



ALTER INDEX "public"."idx_unified_events_id" ATTACH PARTITION "public"."unified_events_2026_08_id_idx";



ALTER INDEX "public"."idx_unified_events_is_resolved" ATTACH PARTITION "public"."unified_events_2026_08_is_resolved_idx";



ALTER INDEX "public"."unified_events_pkey1" ATTACH PARTITION "public"."unified_events_2026_08_pkey";



ALTER INDEX "public"."idx_unified_events_station_category" ATTACH PARTITION "public"."unified_events_2026_08_station_id_event_category_idx";



ALTER INDEX "public"."idx_unified_events_station_id" ATTACH PARTITION "public"."unified_events_2026_08_station_id_idx";



ALTER INDEX "public"."idx_unified_events_actor_id" ATTACH PARTITION "public"."unified_events_2026_09_actor_id_idx";



ALTER INDEX "public"."idx_unified_events_created_at" ATTACH PARTITION "public"."unified_events_2026_09_created_at_idx";



ALTER INDEX "public"."idx_unified_events_id" ATTACH PARTITION "public"."unified_events_2026_09_id_idx";



ALTER INDEX "public"."idx_unified_events_is_resolved" ATTACH PARTITION "public"."unified_events_2026_09_is_resolved_idx";



ALTER INDEX "public"."unified_events_pkey1" ATTACH PARTITION "public"."unified_events_2026_09_pkey";



ALTER INDEX "public"."idx_unified_events_station_category" ATTACH PARTITION "public"."unified_events_2026_09_station_id_event_category_idx";



ALTER INDEX "public"."idx_unified_events_station_id" ATTACH PARTITION "public"."unified_events_2026_09_station_id_idx";



ALTER INDEX "public"."idx_unified_events_actor_id" ATTACH PARTITION "public"."unified_events_2026_10_actor_id_idx";



ALTER INDEX "public"."idx_unified_events_created_at" ATTACH PARTITION "public"."unified_events_2026_10_created_at_idx";



ALTER INDEX "public"."idx_unified_events_id" ATTACH PARTITION "public"."unified_events_2026_10_id_idx";



ALTER INDEX "public"."idx_unified_events_is_resolved" ATTACH PARTITION "public"."unified_events_2026_10_is_resolved_idx";



ALTER INDEX "public"."unified_events_pkey1" ATTACH PARTITION "public"."unified_events_2026_10_pkey";



ALTER INDEX "public"."idx_unified_events_station_category" ATTACH PARTITION "public"."unified_events_2026_10_station_id_event_category_idx";



ALTER INDEX "public"."idx_unified_events_station_id" ATTACH PARTITION "public"."unified_events_2026_10_station_id_idx";



ALTER INDEX "public"."idx_unified_events_actor_id" ATTACH PARTITION "public"."unified_events_2026_11_actor_id_idx";



ALTER INDEX "public"."idx_unified_events_created_at" ATTACH PARTITION "public"."unified_events_2026_11_created_at_idx";



ALTER INDEX "public"."idx_unified_events_id" ATTACH PARTITION "public"."unified_events_2026_11_id_idx";



ALTER INDEX "public"."idx_unified_events_is_resolved" ATTACH PARTITION "public"."unified_events_2026_11_is_resolved_idx";



ALTER INDEX "public"."unified_events_pkey1" ATTACH PARTITION "public"."unified_events_2026_11_pkey";



ALTER INDEX "public"."idx_unified_events_station_category" ATTACH PARTITION "public"."unified_events_2026_11_station_id_event_category_idx";



ALTER INDEX "public"."idx_unified_events_station_id" ATTACH PARTITION "public"."unified_events_2026_11_station_id_idx";



CREATE OR REPLACE TRIGGER "audit_deliveries_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."deliveries" FOR EACH ROW EXECUTE FUNCTION "internal"."audit_trigger_handler"();



CREATE OR REPLACE TRIGGER "audit_tanks_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."tanks" FOR EACH ROW EXECUTE FUNCTION "internal"."audit_trigger_handler"();



CREATE OR REPLACE TRIGGER "audit_transactions" AFTER INSERT OR DELETE OR UPDATE ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "internal"."audit_trigger_handler"();



CREATE OR REPLACE TRIGGER "auto_calculate_delivery_variance" BEFORE INSERT OR UPDATE ON "public"."deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."calculate_delivery_variance"();



CREATE OR REPLACE TRIGGER "check_negative_debt" BEFORE INSERT OR UPDATE ON "public"."fuel_stations" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_negative_debt"();



CREATE OR REPLACE TRIGGER "log_billing_changes" AFTER UPDATE ON "public"."fuel_stations" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"('debt_adjusted', 'Billing record modified');



CREATE OR REPLACE TRIGGER "log_transaction_creation" AFTER INSERT ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"('payment_manually_recorded', 'Transaction created');



CREATE OR REPLACE TRIGGER "on_announcement_created" AFTER INSERT ON "public"."global_announcements" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "on_banner_modified" AFTER INSERT OR UPDATE ON "public"."dashboard_banners" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "on_message_created" BEFORE INSERT ON "public"."ticket_messages" FOR EACH ROW EXECUTE FUNCTION "internal"."stamp_sender_name"();



CREATE OR REPLACE TRIGGER "on_station_created_setup_after" AFTER INSERT ON "public"."fuel_stations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_station_setup_after"();



CREATE OR REPLACE TRIGGER "on_station_created_setup_before" BEFORE INSERT ON "public"."fuel_stations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_station_setup_before"();



CREATE OR REPLACE TRIGGER "tr_audit_immutability" BEFORE DELETE OR UPDATE ON "public"."unified_events" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_tampering"();



CREATE OR REPLACE TRIGGER "tr_prevent_alert_tampering" BEFORE UPDATE ON "public"."alerts" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_alert_tampering"();



CREATE OR REPLACE TRIGGER "tr_protect_profile_fields" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "internal"."protect_profile_fields"();



CREATE OR REPLACE TRIGGER "tr_protect_profile_sensitive_columns" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "internal"."protect_profile_sensitive_columns"();



CREATE OR REPLACE TRIGGER "tr_set_station_id" BEFORE INSERT ON "public"."sensor_readings" FOR EACH ROW EXECUTE FUNCTION "public"."set_sensor_reading_station_id"();



CREATE OR REPLACE TRIGGER "tr_stamp_audit_log_client" BEFORE INSERT ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "internal"."stamp_audit_log_client"();



CREATE OR REPLACE TRIGGER "trg_prevent_last_super_admin_removal" BEFORE UPDATE ON "public"."system_users" FOR EACH ROW EXECUTE FUNCTION "internal"."prevent_last_super_admin_removal"();



CREATE OR REPLACE TRIGGER "trg_sync_system_identity" AFTER INSERT OR UPDATE OF "auth_user_id" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "internal"."sync_system_user_identity"();



CREATE OR REPLACE TRIGGER "trg_tmr_updated_at" BEFORE UPDATE ON "public"."team_member_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_team_member_requests_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_audit_alerts" AFTER INSERT OR DELETE OR UPDATE ON "public"."alerts" FOR EACH ROW EXECUTE FUNCTION "internal"."audit_trigger_handler"();



CREATE OR REPLACE TRIGGER "trigger_audit_deliveries" AFTER INSERT OR DELETE OR UPDATE ON "public"."fuel_transactions" FOR EACH ROW EXECUTE FUNCTION "internal"."audit_trigger_handler"();



CREATE OR REPLACE TRIGGER "trigger_audit_shifts" AFTER INSERT OR DELETE OR UPDATE ON "public"."shift_closures" FOR EACH ROW EXECUTE FUNCTION "internal"."audit_trigger_handler"();



CREATE OR REPLACE TRIGGER "trigger_audit_tanks" AFTER INSERT OR DELETE OR UPDATE ON "public"."tanks" FOR EACH ROW EXECUTE FUNCTION "internal"."audit_trigger_handler"();



CREATE OR REPLACE TRIGGER "trigger_data_smoothing" AFTER INSERT ON "public"."sensor_readings_legacy" FOR EACH ROW EXECUTE FUNCTION "internal"."handle_data_smoothing"();



CREATE OR REPLACE TRIGGER "trigger_sensor_station_lock" BEFORE INSERT OR UPDATE OF "sensor_id", "station_id" ON "public"."tanks" FOR EACH ROW WHEN (("new"."sensor_id" IS NOT NULL)) EXECUTE FUNCTION "public"."check_sensor_station_lock"();



CREATE OR REPLACE TRIGGER "trigger_validate_reading_station" BEFORE INSERT ON "public"."sensor_readings_legacy" FOR EACH ROW EXECUTE FUNCTION "public"."validate_reading_station_match"();



CREATE OR REPLACE TRIGGER "unified_events_immutable" BEFORE DELETE OR UPDATE ON "public"."unified_events_pre_partition" FOR EACH ROW EXECUTE FUNCTION "internal"."prevent_unified_events_mutation"();



CREATE OR REPLACE TRIGGER "update_client_billing_updated_at" BEFORE UPDATE ON "public"."fuel_stations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_deliveries_updated_at" BEFORE UPDATE ON "public"."deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_pending_reg_updated_at" BEFORE UPDATE ON "public"."pending_registrations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_sites_updated_at" BEFORE UPDATE ON "public"."sites" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_support_tickets_updated_at" BEFORE UPDATE ON "public"."support_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_tank_state" AFTER INSERT ON "public"."sensor_readings_legacy" FOR EACH ROW EXECUTE FUNCTION "public"."update_tank_from_sensor"();



CREATE OR REPLACE TRIGGER "update_tanks_updated_at" BEFORE UPDATE ON "public"."tanks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "validate_sensor_reading_trigger" BEFORE INSERT OR UPDATE ON "public"."sensor_readings_legacy" FOR EACH ROW EXECUTE FUNCTION "internal"."validate_sensor_reading"();



ALTER TABLE ONLY "public"."ai_recommendations"
    ADD CONSTRAINT "ai_recommendations_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alerts"
    ADD CONSTRAINT "alerts_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alerts"
    ADD CONSTRAINT "alerts_supabase_uid_fkey" FOREIGN KEY ("supabase_uid") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."alerts"
    ADD CONSTRAINT "alerts_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "public"."tanks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."analysis_history"
    ADD CONSTRAINT "analysis_history_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analysis_history"
    ADD CONSTRAINT "analysis_history_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."file_uploads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auth_events"
    ADD CONSTRAINT "auth_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_plans"
    ADD CONSTRAINT "billing_plans_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."billing_customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_transactions"
    ADD CONSTRAINT "billing_transactions_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id");



ALTER TABLE ONLY "public"."fuel_stations"
    ADD CONSTRAINT "client_billing_supabase_uid_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."current_station_shifts"
    ADD CONSTRAINT "current_station_shifts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."current_station_shifts"
    ADD CONSTRAINT "current_station_shifts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "public"."tanks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_banners"
    ADD CONSTRAINT "dashboard_banners_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_supabase_uid_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "public"."tanks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."device_commands"
    ADD CONSTRAINT "device_commands_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."device_tokens"
    ADD CONSTRAINT "device_tokens_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."device_tokens"
    ADD CONSTRAINT "device_tokens_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."device_tokens"
    ADD CONSTRAINT "device_tokens_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "public"."tanks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."file_uploads"
    ADD CONSTRAINT "file_uploads_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."firmware_campaigns"
    ADD CONSTRAINT "firmware_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fuel_stations"
    ADD CONSTRAINT "fuel_stations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fuel_stations"
    ADD CONSTRAINT "fuel_stations_supabase_uid_fkey" FOREIGN KEY ("supabase_uid") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fuel_transactions"
    ADD CONSTRAINT "fuel_transactions_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fuel_transactions"
    ADD CONSTRAINT "fuel_transactions_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "public"."tanks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."global_announcements"
    ADD CONSTRAINT "global_announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."internal_api_keys"
    ADD CONSTRAINT "internal_api_keys_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loss_reviews"
    ADD CONSTRAINT "loss_reviews_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."market_action_queue"
    ADD CONSTRAINT "market_action_queue_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."market_bookmarks"
    ADD CONSTRAINT "market_bookmarks_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."market_news"
    ADD CONSTRAINT "market_news_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."market_signals"
    ADD CONSTRAINT "market_signals_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."newsletter_templates"
    ADD CONSTRAINT "newsletter_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."paystack_config"
    ADD CONSTRAINT "paystack_config_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pending_registrations"
    ADD CONSTRAINT "pending_registrations_approved_station_id_fkey" FOREIGN KEY ("approved_station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_supabase_uid_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."raw_market_data"
    ADD CONSTRAINT "raw_market_data_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."regulatory_notices"
    ADD CONSTRAINT "regulatory_notices_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sensor_readings_legacy"
    ADD CONSTRAINT "sensor_readings_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE "public"."sensor_readings"
    ADD CONSTRAINT "sensor_readings_partitioned_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id");



ALTER TABLE "public"."sensor_readings"
    ADD CONSTRAINT "sensor_readings_partitioned_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "public"."tanks"("id");



ALTER TABLE ONLY "public"."sensor_readings_legacy"
    ADD CONSTRAINT "sensor_readings_supabase_uid_fkey" FOREIGN KEY ("supabase_uid") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sensor_readings_legacy"
    ADD CONSTRAINT "sensor_readings_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "public"."tanks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_closures"
    ADD CONSTRAINT "shift_closures_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."shift_closures"
    ADD CONSTRAINT "shift_closures_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_closures"
    ADD CONSTRAINT "shift_closures_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_closures"
    ADD CONSTRAINT "shift_closures_supabase_uid_fkey" FOREIGN KEY ("supabase_uid") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."shift_closures"
    ADD CONSTRAINT "shift_closures_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "public"."tanks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_supabase_uid_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_notifications"
    ADD CONSTRAINT "system_notifications_target_admin_id_fkey" FOREIGN KEY ("target_admin_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_users"
    ADD CONSTRAINT "system_users_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_users"
    ADD CONSTRAINT "system_users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."system_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tanks"
    ADD CONSTRAINT "tanks_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tanks"
    ADD CONSTRAINT "tanks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tanks"
    ADD CONSTRAINT "tanks_supabase_uid_fkey" FOREIGN KEY ("supabase_uid") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."team_member_requests"
    ADD CONSTRAINT "team_member_requests_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."telemetry_history"
    ADD CONSTRAINT "telemetry_history_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."telemetry_history"
    ADD CONSTRAINT "telemetry_history_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id");



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_client_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_reversed_by_transaction_id_fkey" FOREIGN KEY ("reversed_by_transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_reverses_transaction_id_fkey" FOREIGN KEY ("reverses_transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_supabase_uid_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."unified_events_pre_partition"
    ADD CONSTRAINT "unified_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE "public"."unified_events"
    ADD CONSTRAINT "unified_events_actor_id_fkey1" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."unified_events_pre_partition"
    ADD CONSTRAINT "unified_events_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE "public"."unified_events"
    ADD CONSTRAINT "unified_events_station_id_fkey1" FOREIGN KEY ("station_id") REFERENCES "public"."fuel_stations"("station_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admin full access" ON "public"."analysis_history" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin full access" ON "public"."audit_logs" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin full access" ON "public"."devices" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin full access" ON "public"."file_uploads" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin full access" ON "public"."raw_market_data" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin full access" ON "public"."support_tickets" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can modify system_settings" ON "public"."system_settings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['super_admin'::"text", 'owner'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['super_admin'::"text", 'owner'::"text"]))))));



CREATE POLICY "Admins can view all leads" ON "public"."marketing_leads" FOR SELECT TO "authenticated" USING ("public"."is_system_admin"('admin_helper'::"text"));



CREATE POLICY "Admins can view telemetry" ON "public"."security_telemetry_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."system_users"
  WHERE (("system_users"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("system_users"."role" = ANY (ARRAY['super_admin'::"text", 'admin_helper'::"text"]))))));



CREATE POLICY "Admins can view their own billing" ON "public"."billing_transactions" FOR SELECT TO "authenticated" USING (("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Admins full access to firmware_campaigns" ON "public"."firmware_campaigns" USING ("public"."is_system_admin"('admin_helper'::"text"));



CREATE POLICY "Admins full access to newsletter_templates" ON "public"."newsletter_templates" USING ("public"."is_system_admin"('admin_helper'::"text"));



CREATE POLICY "Admins full access to system_tasks" ON "public"."system_tasks" USING ("public"."is_system_admin"('admin_helper'::"text"));



CREATE POLICY "Admins manage action queue" ON "public"."market_action_queue" USING ((EXISTS ( SELECT 1
   FROM "public"."system_users"
  WHERE (("system_users"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("system_users"."is_active" = true)))));



CREATE POLICY "Admins manage invoices" ON "public"."invoices" USING ((EXISTS ( SELECT 1
   FROM "public"."system_users"
  WHERE (("system_users"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("system_users"."is_active" = true)))));



CREATE POLICY "Admins manage system notifications" ON "public"."system_notifications" USING ((EXISTS ( SELECT 1
   FROM "public"."system_users"
  WHERE (("system_users"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("system_users"."is_active" = true)))));



CREATE POLICY "Admins manage ticket messages" ON "public"."ticket_messages" USING ((EXISTS ( SELECT 1
   FROM "public"."system_users"
  WHERE (("system_users"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("system_users"."is_active" = true)))));



CREATE POLICY "Allow authenticated inserts to unified_events" ON "public"."unified_events" FOR INSERT TO "authenticated" WITH CHECK (("actor_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Allow authenticated inserts to unified_events" ON "public"."unified_events_pre_partition" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "actor_id"));



CREATE POLICY "Allow authenticated read dashboard_banners" ON "public"."dashboard_banners" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated read global_announcements" ON "public"."global_announcements" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated read market_news" ON "public"."market_news" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated read regulatory_notices" ON "public"."regulatory_notices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to read RSS cache" ON "public"."rss_cache" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow staff delete dashboard_banners" ON "public"."dashboard_banners" FOR DELETE TO "authenticated" USING (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff delete global_announcements" ON "public"."global_announcements" FOR DELETE TO "authenticated" USING (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff delete market_news" ON "public"."market_news" FOR DELETE TO "authenticated" USING (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff delete regulatory_notices" ON "public"."regulatory_notices" FOR DELETE TO "authenticated" USING (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff insert dashboard_banners" ON "public"."dashboard_banners" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff insert global_announcements" ON "public"."global_announcements" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff insert market_news" ON "public"."market_news" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff insert regulatory_notices" ON "public"."regulatory_notices" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff update dashboard_banners" ON "public"."dashboard_banners" FOR UPDATE TO "authenticated" USING (( SELECT "public"."check_is_staff"() AS "check_is_staff")) WITH CHECK (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff update global_announcements" ON "public"."global_announcements" FOR UPDATE TO "authenticated" USING (( SELECT "public"."check_is_staff"() AS "check_is_staff")) WITH CHECK (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff update market_news" ON "public"."market_news" FOR UPDATE TO "authenticated" USING (( SELECT "public"."check_is_staff"() AS "check_is_staff")) WITH CHECK (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Allow staff update regulatory_notices" ON "public"."regulatory_notices" FOR UPDATE TO "authenticated" USING (( SELECT "public"."check_is_staff"() AS "check_is_staff")) WITH CHECK (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "Anyone can join the newsletter" ON "public"."marketing_leads" FOR INSERT TO "authenticated", "anon" WITH CHECK ((("email" IS NOT NULL) AND (POSITION(('@'::"text") IN ("email")) > 1)));



CREATE POLICY "Anyone can request registration" ON "public"."pending_registrations" FOR INSERT TO "authenticated", "anon" WITH CHECK ((("email" IS NOT NULL) AND ("station_name" IS NOT NULL)));



CREATE POLICY "Authenticated read for lookup tables" ON "public"."volume_lookup_tables" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read supply risks" ON "public"."supply_risks" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view own readings" ON "public"."sensor_readings_default" FOR SELECT TO "authenticated" USING (("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Authenticated users can view own readings" ON "public"."sensor_readings_y2026m05" FOR SELECT TO "authenticated" USING (("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Authenticated users can view own readings" ON "public"."sensor_readings_y2026m06" FOR SELECT TO "authenticated" USING (("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Authenticated users can view own readings" ON "public"."sensor_readings_y2026m07" FOR SELECT TO "authenticated" USING (("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Consolidated alerts access" ON "public"."alerts" TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff"))) WITH CHECK ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated auth_attempts SELECT" ON "public"."auth_attempts" FOR SELECT TO "authenticated" USING ((("email" IS NOT NULL) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated deliveries access" ON "public"."deliveries" TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated market_prices SELECT" ON "public"."market_prices" FOR SELECT USING (true);



CREATE POLICY "Consolidated profiles SELECT" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated profiles UPDATE" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff"))) WITH CHECK ((("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated security_telemetry_events INSERT" ON "public"."security_telemetry_events" FOR INSERT WITH CHECK (("event_type" IS NOT NULL));



CREATE POLICY "Consolidated sensor_readings_legacy access" ON "public"."sensor_readings_legacy" TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff"))) WITH CHECK ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated shift_closures access" ON "public"."shift_closures" TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated sites access" ON "public"."sites" TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated system_users access" ON "public"."system_users" TO "authenticated" USING ((("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff"))) WITH CHECK ((("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated tanks access" ON "public"."tanks" TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff"))) WITH CHECK ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated team_member_requests access" ON "public"."team_member_requests" TO "authenticated" USING ((("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff"))) WITH CHECK ((("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated transactions access" ON "public"."transactions" TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff"))) WITH CHECK ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Consolidated unified_events_pre_partition SELECT" ON "public"."unified_events_pre_partition" FOR SELECT TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Devices can update last_reading_at for heartbeats" ON "public"."tanks" FOR UPDATE USING ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'role'::"text") = 'device'::"text") AND (((( SELECT "auth"."jwt"() AS "jwt") ->> 'tank_id'::"text"))::"uuid" = "id"))) WITH CHECK ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'role'::"text") = 'device'::"text") AND (((( SELECT "auth"."jwt"() AS "jwt") ->> 'tank_id'::"text"))::"uuid" = "id")));



CREATE POLICY "Devices can update their command status" ON "public"."device_commands" FOR UPDATE USING ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'role'::"text") = 'device'::"text") AND (((( SELECT "auth"."jwt"() AS "jwt") ->> 'station_id'::"text"))::"uuid" = "station_id"))) WITH CHECK ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'role'::"text") = 'device'::"text") AND (((( SELECT "auth"."jwt"() AS "jwt") ->> 'station_id'::"text"))::"uuid" = "station_id")));



CREATE POLICY "ESP devices can insert via anon" ON "public"."sensor_readings" FOR INSERT TO "anon" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."tanks" "t"
  WHERE (("t"."id" = "sensor_readings"."tank_id") AND ("t"."status" = 'active'::"text")))));



CREATE POLICY "Hardware devices can insert readings" ON "public"."sensor_readings" FOR INSERT WITH CHECK (((( SELECT "auth"."role"() AS "role") = 'service_role'::"text") OR (((( SELECT "auth"."jwt"() AS "jwt") ->> 'role'::"text") = 'device'::"text") AND ("station_id" = ((( SELECT "auth"."jwt"() AS "jwt") ->> 'station_id'::"text"))::"uuid"))));



CREATE POLICY "Hardware devices can insert telemetry" ON "public"."telemetry_history" FOR INSERT WITH CHECK ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'role'::"text") = 'device'::"text") AND (((( SELECT "auth"."jwt"() AS "jwt") ->> 'station_id'::"text"))::"uuid" = "station_id")));



CREATE POLICY "Public can insert auth attempts" ON "public"."auth_attempts" FOR INSERT WITH CHECK (("email" IS NOT NULL));



CREATE POLICY "Public read for canned responses" ON "public"."canned_responses" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Public read for knowledge base" ON "public"."knowledge_base" FOR SELECT TO "authenticated" USING (("is_published" = true));



CREATE POLICY "Public read for support metadata" ON "public"."support_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Service role can insert sensor readings" ON "public"."sensor_readings_legacy" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can manage system users" ON "public"."system_users" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role has full access to system_settings" ON "public"."system_settings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role managed" ON "public"."scraper_rate_limits" TO "service_role" USING (true);



CREATE POLICY "Service role may insert unified_events" ON "public"."unified_events" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role may purge unified_events" ON "public"."unified_events_pre_partition" FOR DELETE TO "service_role" USING (true);



CREATE POLICY "Station admins can delete events" ON "public"."unified_events" FOR DELETE TO "authenticated" USING ((("public"."get_auth_level"() <= 4) OR (("public"."get_auth_level"() <= 6) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."station_id" = "unified_events"."station_id")))))));



CREATE POLICY "Station admins can delete events" ON "public"."unified_events_pre_partition" FOR DELETE USING ((("station_id" = ( SELECT "public"."get_station_id_from_auth"() AS "get_station_id_from_auth")) AND ( SELECT ((("public"."get_user_bundle_v2"() ->> 'auth_level'::"text"))::integer <= 5))));



CREATE POLICY "Station admins can revoke their device tokens" ON "public"."device_tokens" FOR UPDATE TO "authenticated" USING (("station_id" IN ( SELECT "p"."station_id"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text"])))))) WITH CHECK (("station_id" IN ( SELECT "p"."station_id"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text"]))))));



CREATE POLICY "Station admins can view their device tokens" ON "public"."device_tokens" FOR SELECT TO "authenticated" USING ((("station_id" IN ( SELECT "p"."station_id"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text"]))))) OR "public"."is_system_admin"('support_staff'::"text")));



CREATE POLICY "Station members can manage shift status" ON "public"."current_station_shifts" TO "authenticated" USING (("station_id" = ( SELECT "public"."get_station_id_from_auth"() AS "get_station_id_from_auth"))) WITH CHECK (("station_id" = ( SELECT "public"."get_station_id_from_auth"() AS "get_station_id_from_auth")));



CREATE POLICY "Station members can update unified events" ON "public"."unified_events_pre_partition" FOR UPDATE USING (("station_id" = ( SELECT "public"."get_station_id_from_auth"() AS "get_station_id_from_auth")));



CREATE POLICY "Station members can view unified events" ON "public"."unified_events" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."station_id" = "unified_events"."station_id") AND ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ("public"."get_auth_level"() <= 4)));



CREATE POLICY "Station members can view unified events" ON "public"."unified_events_2026_03" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."station_id" = "unified_events_2026_03"."station_id") AND ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (( SELECT "public"."get_auth_level"() AS "get_auth_level") <= 4)));



CREATE POLICY "Station members can view unified events" ON "public"."unified_events_2026_04" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."station_id" = "unified_events_2026_04"."station_id") AND ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (( SELECT "public"."get_auth_level"() AS "get_auth_level") <= 4)));



CREATE POLICY "Station members can view unified events" ON "public"."unified_events_2026_05" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."station_id" = "unified_events_2026_05"."station_id") AND ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (( SELECT "public"."get_auth_level"() AS "get_auth_level") <= 4)));



CREATE POLICY "Station members can view unified events" ON "public"."unified_events_2026_06" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."station_id" = "unified_events_2026_06"."station_id") AND ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (( SELECT "public"."get_auth_level"() AS "get_auth_level") <= 4)));



CREATE POLICY "Station owners can manage their Paystack config" ON "public"."paystack_config" USING ((("station_id" = ( SELECT "public"."get_station_id_from_auth"() AS "get_station_id_from_auth")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Station owners can manage their billing customers" ON "public"."billing_customers" USING ((("station_id" = "public"."get_station_id_from_auth"()) OR "public"."is_admin"()));



CREATE POLICY "Station owners can manage their billing plans" ON "public"."billing_plans" USING ((("station_id" = "public"."get_station_id_from_auth"()) OR "public"."is_admin"()));



CREATE POLICY "Station owners can manage their billing subscriptions" ON "public"."billing_subscriptions" USING ((("station_id" = "public"."get_station_id_from_auth"()) OR "public"."is_admin"()));



CREATE POLICY "Station owners can manage their internal API keys" ON "public"."internal_api_keys" USING ((("station_id" = "public"."get_station_id_from_auth"()) OR "public"."is_admin"()));



CREATE POLICY "Super Admin station management" ON "public"."fuel_stations" FOR UPDATE TO "authenticated" USING ("public"."check_is_super_admin"()) WITH CHECK ("public"."check_is_super_admin"());



CREATE POLICY "Super Admins can manage AI recommendations" ON "public"."ai_recommendations" USING ((EXISTS ( SELECT 1
   FROM "public"."system_users"
  WHERE (("system_users"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("system_users"."role" = 'super_admin'::"text")))));



CREATE POLICY "System admins can delete pending registrations" ON "public"."pending_registrations" FOR DELETE TO "authenticated" USING ("public"."is_system_admin"(2));



CREATE POLICY "System admins can update pending registrations" ON "public"."pending_registrations" FOR UPDATE TO "authenticated" USING ("public"."is_system_admin"('support_staff'::"text")) WITH CHECK ("public"."is_system_admin"('support_staff'::"text"));



CREATE POLICY "System admins can view all pending registrations" ON "public"."pending_registrations" FOR SELECT TO "authenticated" USING ("public"."is_system_admin"('support_staff'::"text"));



CREATE POLICY "System admins view all auth events" ON "public"."auth_events" FOR SELECT TO "authenticated" USING ("public"."is_system_admin"('support_staff'::"text"));



CREATE POLICY "System can insert transactions" ON "public"."billing_transactions" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."get_auth_level"() AS "get_auth_level") <= 4));



CREATE POLICY "Tenant isolation" ON "public"."fuel_transactions" USING ((("station_id" = "public"."get_user_station_id"()) OR "public"."is_system_admin"('support_staff'::"text")));



CREATE POLICY "Tenant isolation" ON "public"."reports" USING ((("station_id" = "public"."get_user_station_id"()) OR "public"."is_system_admin"('support_staff'::"text")));



CREATE POLICY "Tenant isolation for daily summaries" ON "public"."daily_summaries" FOR SELECT TO "authenticated" USING ((("tank_id" IN ( SELECT "tanks"."id"
   FROM "public"."tanks"
  WHERE ("tanks"."station_id" = "public"."get_station_id_from_auth"()))) OR "public"."is_system_admin"(3)));



CREATE POLICY "Users can insert station commands" ON "public"."device_commands" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."station_id" = "profiles"."station_id")))));



CREATE POLICY "Users can manage their own tokens" ON "public"."user_push_tokens" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "auth_user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "auth_user_id"));



CREATE POLICY "Users can resolve own station events" ON "public"."unified_events" FOR UPDATE TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR (( SELECT "public"."get_auth_level"() AS "get_auth_level") <= 4))) WITH CHECK (("is_resolved" IS NOT NULL));



CREATE POLICY "Users can view own sensor readings" ON "public"."sensor_readings" FOR SELECT TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "Users can view their station commands" ON "public"."device_commands" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."station_id" = "device_commands"."station_id")))));



CREATE POLICY "Users manage own preferences" ON "public"."user_preferences" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."ai_recommendations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."analysis_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auth_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auth_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."canned_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."current_station_shifts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_summaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_banners" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."device_commands" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."device_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."file_uploads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."firmware_campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fuel_stations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fuel_stations_delete" ON "public"."fuel_stations" FOR DELETE TO "authenticated" USING (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "fuel_stations_insert" ON "public"."fuel_stations" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."check_is_staff"() AS "check_is_staff"));



CREATE POLICY "fuel_stations_select" ON "public"."fuel_stations" FOR SELECT TO "authenticated" USING ((("station_id" IN ( SELECT "profiles"."station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "fuel_stations_update" ON "public"."fuel_stations" FOR UPDATE TO "authenticated" USING ((((( SELECT "auth"."uid"() AS "uid") = "owner_id") AND (("station_name" IS NULL) OR ("station_name" = 'Organization Setup Pending'::"text"))) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "owner_id") OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



ALTER TABLE "public"."fuel_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."global_announcements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."internal_api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."knowledge_base" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loss_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loss_reviews_station_access" ON "public"."loss_reviews" TO "authenticated" USING (("station_id" = (( SELECT "auth"."jwt"() AS "jwt") ->> 'station_id'::"text"))) WITH CHECK (("station_id" = (( SELECT "auth"."jwt"() AS "jwt") ->> 'station_id'::"text")));



ALTER TABLE "public"."market_action_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_bookmarks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_news" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_signals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "market_signals_delete" ON "public"."market_signals" FOR DELETE TO "authenticated" USING ((("station_id" = "public"."get_my_station_id"()) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "market_signals_insert" ON "public"."market_signals" FOR INSERT TO "authenticated" WITH CHECK ((("station_id" = "public"."get_my_station_id"()) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "market_signals_select" ON "public"."market_signals" FOR SELECT TO "authenticated" USING ((("station_id" = "public"."get_my_station_id"()) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



CREATE POLICY "market_signals_update" ON "public"."market_signals" FOR UPDATE TO "authenticated" USING ((("station_id" = "public"."get_my_station_id"()) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff"))) WITH CHECK ((("station_id" = "public"."get_my_station_id"()) OR ( SELECT "public"."check_is_staff"() AS "check_is_staff")));



ALTER TABLE "public"."marketing_leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."newsletter_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paystack_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_registrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."raw_market_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."regulatory_notices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rss_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scraper_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."security_telemetry_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "security_telemetry_events: insert requires event_type" ON "public"."security_telemetry_events" FOR INSERT WITH CHECK (("event_type" IS NOT NULL));



ALTER TABLE "public"."sensor_readings_default" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sensor_readings_legacy" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sensor_readings_y2026m05" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sensor_readings_y2026m06" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sensor_readings_y2026m07" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service role manages edge rate limits" ON "public"."edge_rate_limits" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role manages fuel transactions" ON "public"."fuel_transactions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service role manages market bookmarks" ON "public"."market_bookmarks" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."shift_closures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supply_risks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tanks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_member_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."telemetry_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticket_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unified_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unified_events_2026_03" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unified_events_2026_04" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unified_events_2026_05" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unified_events_2026_06" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unified_events_pre_partition" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_push_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."volume_lookup_tables" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."alerts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."current_station_shifts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."device_commands";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."market_news";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sensor_readings_legacy";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."shift_closures";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tanks";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."unified_events_pre_partition";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































REVOKE ALL ON FUNCTION "internal"."audit_trigger_handler"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."audit_trigger_handler"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."audit_trigger_handler"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."check_sla_breaches"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."check_sla_breaches"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."check_sla_breaches"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."check_tank_thresholds"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."check_tank_thresholds"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."check_tank_thresholds"() TO "service_role";



GRANT ALL ON TABLE "public"."security_telemetry_events" TO "anon";
GRANT ALL ON TABLE "public"."security_telemetry_events" TO "authenticated";
GRANT ALL ON TABLE "public"."security_telemetry_events" TO "service_role";



REVOKE ALL ON FUNCTION "internal"."claim_pending_critical_alert_events"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."claim_pending_critical_alert_events"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "internal"."claim_pending_critical_alert_events"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "internal"."complete_critical_alert_event"("p_event_id" "uuid", "p_sent" boolean, "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."complete_critical_alert_event"("p_event_id" "uuid", "p_sent" boolean, "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "internal"."complete_critical_alert_event"("p_event_id" "uuid", "p_sent" boolean, "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "internal"."handle_data_smoothing"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."handle_data_smoothing"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."handle_data_smoothing"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."handle_user_deletion"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "internal"."manage_event_partitions"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "internal"."prevent_last_super_admin_removal"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."prevent_last_super_admin_removal"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."prevent_last_super_admin_removal"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."prevent_unified_events_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."prevent_unified_events_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."prevent_unified_events_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."process_monthly_invoicing"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."process_monthly_invoicing"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."process_monthly_invoicing"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."protect_profile_fields"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."protect_profile_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."protect_profile_fields"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."protect_profile_sensitive_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."protect_profile_sensitive_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."protect_profile_sensitive_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."purge_edge_rate_limits"("p_older_than_hours" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."purge_edge_rate_limits"("p_older_than_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "internal"."purge_edge_rate_limits"("p_older_than_hours" integer) TO "service_role";



REVOKE ALL ON FUNCTION "internal"."purge_security_telemetry_events"("p_older_than_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."purge_security_telemetry_events"("p_older_than_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "internal"."purge_security_telemetry_events"("p_older_than_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "internal"."safe_harden_table"("p_table_name" "text", "p_firebase_col" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."safe_harden_table"("p_table_name" "text", "p_firebase_col" "text") TO "authenticated";
GRANT ALL ON FUNCTION "internal"."safe_harden_table"("p_table_name" "text", "p_firebase_col" "text") TO "service_role";



REVOKE ALL ON FUNCTION "internal"."safe_unschedule_job"("p_job_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."safe_unschedule_job"("p_job_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "internal"."safe_unschedule_job"("p_job_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "internal"."stamp_admin_log_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."stamp_admin_log_user"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."stamp_admin_log_user"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."stamp_audit_log_client"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."stamp_audit_log_client"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."stamp_audit_log_client"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."stamp_sender_name"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."stamp_sender_name"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."stamp_sender_name"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."sync_system_user_identity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."sync_system_user_identity"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."sync_system_user_identity"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."update_tank_from_sensor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."update_tank_from_sensor"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."update_tank_from_sensor"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."update_tank_state"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."update_tank_state"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."update_tank_state"() TO "service_role";



REVOKE ALL ON FUNCTION "internal"."validate_sensor_reading"() FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."validate_sensor_reading"() TO "authenticated";
GRANT ALL ON FUNCTION "internal"."validate_sensor_reading"() TO "service_role";









GRANT ALL ON FUNCTION "public"."add_debt_to_client"("p_station_id" "uuid", "p_amount" numeric, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_debt_to_client"("p_station_id" "uuid", "p_amount" numeric, "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_adjust_station_debt"("p_station_id" "uuid", "p_adjustment_amount" numeric, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_adjust_station_debt"("p_station_id" "uuid", "p_adjustment_amount" numeric, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_adjust_station_debt"("p_station_id" "uuid", "p_adjustment_amount" numeric, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_monthly_billing"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_monthly_billing"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_trigger_handler"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_trigger_handler"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_delivery_variance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_delivery_variance"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_standard_volume"("ambient_volume" numeric, "current_temp" numeric, "fuel_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_standard_volume"("ambient_volume" numeric, "current_temp" numeric, "fuel_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_auth_attempt"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_auth_attempt"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_auth_attempt"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_index_exists"("p_index_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_index_exists"("p_index_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_index_exists"("p_index_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_is_staff"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_is_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_is_staff"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_is_super_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_my_identity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_my_identity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_my_identity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_sensor_station_lock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_sensor_station_lock"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_station_active"("p_station_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_station_active"("p_station_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_station_active"("p_station_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_station_active"("p_station_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_events"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_events"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_rss_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_rss_cache"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_edge_rate_limit"("p_scope_key" "text", "p_endpoint" "text", "p_window_seconds" integer, "p_max_requests" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_edge_rate_limit"("p_scope_key" "text", "p_endpoint" "text", "p_window_seconds" integer, "p_max_requests" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_auth_uid_text"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_auth_uid_text"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_auth_uid_text"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_safely"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_safely"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_safely"("target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."detect_theft_anomaly"("p_tank_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."detect_theft_anomaly"("p_tank_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."disable_security_pin"() TO "anon";
GRANT ALL ON FUNCTION "public"."disable_security_pin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."disable_security_pin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."emergency_set_station_name"("p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."emergency_set_station_name"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."emergency_set_station_name"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_billing_suspensions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_billing_suspensions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_user_profile_exists"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_user_profile_exists"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_user_profile_exists"() TO "service_role";



GRANT ALL ON FUNCTION "public"."firebase_uid"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."firebase_uid"() TO "service_role";



GRANT ALL ON FUNCTION "public"."forensic_update_market_price"("p_fuel_type" "text", "p_new_price" numeric, "p_effective_date" timestamp with time zone, "p_source_url" "text", "p_is_official" boolean, "p_signal_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."forensic_update_market_price"("p_fuel_type" "text", "p_new_price" numeric, "p_effective_date" timestamp with time zone, "p_source_url" "text", "p_is_official" boolean, "p_signal_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."forensic_update_market_price"("p_fuel_type" "text", "p_new_price" numeric, "p_effective_date" timestamp with time zone, "p_source_url" "text", "p_is_official" boolean, "p_signal_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_dashboard_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_dashboard_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_dashboard_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_admin_risk_matrix"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_admin_risk_matrix"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_risk_matrix"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_auth_level"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_auth_level"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_auth_level"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_business_kpis"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_business_kpis"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_business_kpis"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_business_kpis_v2"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_business_kpis_v2"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_business_kpis_v2"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_station_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_station_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_station_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_station_dashboard_summary"("p_station_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_station_dashboard_summary"("p_station_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_station_dashboard_summary"("p_station_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_station_id_from_auth"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_station_id_from_auth"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_station_id_from_auth"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_supplier_reliability_score"("p_supplier_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_supplier_reliability_score"("p_supplier_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_supplier_reliability_score"("p_supplier_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tank_analytics_30d"("p_station_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tank_analytics_30d"("p_station_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tank_analytics_30d"("p_station_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tankiq_audit_logs"("p_station_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tankiq_audit_logs"("p_station_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_audit_logs"("p_station_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tankiq_consumption_stats"("p_station_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_consumption_stats"("p_station_id" "uuid", "p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tankiq_delivery_logs"("p_station_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_delivery_logs"("p_station_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tankiq_financial_status"("p_station_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tankiq_financial_status"("p_station_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_financial_status"("p_station_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tankiq_hardware_health"("p_station_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tankiq_hardware_health"("p_station_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_hardware_health"("p_station_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tankiq_market_context"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_market_context"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tankiq_shift_analytics"("p_station_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tankiq_shift_analytics"("p_station_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_shift_analytics"("p_station_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tankiq_station_summary"("p_station_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tankiq_station_summary"("p_station_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_station_summary"("p_station_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tankiq_support_summary"("p_station_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tankiq_support_summary"("p_station_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_support_summary"("p_station_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tankiq_usage_insights"("p_station_id" "uuid", "p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tankiq_usage_insights"("p_station_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tankiq_usage_insights"("p_station_id" "uuid", "p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_bundle_v2"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_bundle_v2"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_bundle_v2"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_client_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_client_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_station_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_station_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_station_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_station_setup"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_station_setup"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_station_setup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_station_setup"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_station_setup_after"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_station_setup_after"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_station_setup_after"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_station_setup_after"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_station_setup_before"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_station_setup_before"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_station_setup_before"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_station_setup_before"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_client_access"("required_level" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_client_access"("required_level" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_client_access"("required_level" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_system_admin"("minimum_level" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_system_admin"("minimum_level" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_system_admin"("minimum_level" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_system_admin"("minimum_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_system_admin"("minimum_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_system_admin"("minimum_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_admin_action"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_admin_action"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_admin_action"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_auth_attempt"("p_email" "text", "p_is_success" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_auth_attempt"("p_email" "text", "p_is_success" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_auth_attempt"("p_email" "text", "p_success" boolean, "p_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_auth_attempt"("p_email" "text", "p_success" boolean, "p_ip" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_auth_event"("p_event_type" "text", "p_user_email" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_status" "text", "p_error_message" "text", "p_detail_json" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_auth_event"("p_event_type" "text", "p_user_email" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_status" "text", "p_error_message" "text", "p_detail_json" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_registration_event"("p_registration_id" "uuid", "p_event_type" "text", "p_actor_email" "text", "p_notes" "text", "p_detail_json" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_registration_event"("p_registration_id" "uuid", "p_event_type" "text", "p_actor_email" "text", "p_notes" "text", "p_detail_json" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_security_telemetry_event"("p_event_type" "text", "p_severity" "text", "p_source" "text", "p_endpoint" "text", "p_actor_uid" "uuid", "p_actor_email" "text", "p_actor_role" "text", "p_actor_auth_level" integer, "p_station_id" "uuid", "p_scope_key" "text", "p_status_code" integer, "p_reason" "text", "p_details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_security_telemetry_event"("p_event_type" "text", "p_severity" "text", "p_source" "text", "p_endpoint" "text", "p_actor_uid" "uuid", "p_actor_email" "text", "p_actor_role" "text", "p_actor_auth_level" integer, "p_station_id" "uuid", "p_scope_key" "text", "p_status_code" integer, "p_reason" "text", "p_details" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_alert_tampering"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_alert_tampering"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_audit_tampering"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_audit_tampering"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_negative_debt"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_negative_debt"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_payment"("p_station_id" "uuid", "p_amount" numeric, "p_payment_method" "text", "p_payment_reference" "text", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."process_payment"("p_station_id" "uuid", "p_amount" numeric, "p_payment_method" "text", "p_payment_reference" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_payment"("p_station_id" "uuid", "p_amount" numeric, "p_payment_method" "text", "p_payment_reference" "text", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."provision_registration_v2"("p_registration_id" "uuid", "p_auth_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."provision_registration_v2"("p_registration_id" "uuid", "p_auth_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."provision_registration_v2"("p_registration_id" "uuid", "p_auth_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_tank_analytics"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_tank_analytics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_tank_analytics"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."repair_my_identity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."repair_my_identity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."repair_my_identity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_all_station_events"("p_station_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_all_station_events"("p_station_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_all_station_events"("p_station_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_unified_event"("p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_unified_event"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_unified_event"("p_event_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_sensor_reading_station_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_sensor_reading_station_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."setup_security_pin"("p_pin_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."setup_security_pin"("p_pin_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."setup_security_pin"("p_pin_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_master_password"("new_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_master_password"("new_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_master_password"("new_password" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_tank_from_sensor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_tank_from_sensor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_team_member_requests_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_team_member_requests_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_title" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_title" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_alert_v2"("p_station_id" "uuid", "p_tank_id" "uuid", "p_alert_type" "text", "p_title" "text", "p_message" "text", "p_severity" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_owns_client"("client_firebase_uid" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_owns_client"("client_firebase_uid" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_owns_client"("client_firebase_uid" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_reading_station_match"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_reading_station_match"() TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_master_password"("test_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_master_password"("test_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_master_password"("test_password" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_security_pin"("p_pin_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_security_pin"("p_pin_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_security_pin"("p_pin_hash" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."ai_recommendations" TO "anon";
GRANT ALL ON TABLE "public"."ai_recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_recommendations" TO "service_role";



GRANT ALL ON TABLE "public"."alerts" TO "anon";
GRANT ALL ON TABLE "public"."alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."alerts" TO "service_role";



GRANT ALL ON TABLE "public"."analysis_history" TO "anon";
GRANT ALL ON TABLE "public"."analysis_history" TO "authenticated";
GRANT ALL ON TABLE "public"."analysis_history" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."auth_attempts" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."auth_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."auth_events" TO "anon";
GRANT ALL ON TABLE "public"."auth_events" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_events" TO "service_role";



GRANT ALL ON TABLE "public"."billing_customers" TO "anon";
GRANT ALL ON TABLE "public"."billing_customers" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_customers" TO "service_role";



GRANT ALL ON TABLE "public"."billing_plans" TO "anon";
GRANT ALL ON TABLE "public"."billing_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_plans" TO "service_role";



GRANT ALL ON TABLE "public"."billing_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."billing_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."billing_transactions" TO "anon";
GRANT ALL ON TABLE "public"."billing_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."canned_responses" TO "anon";
GRANT ALL ON TABLE "public"."canned_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."canned_responses" TO "service_role";



GRANT ALL ON TABLE "public"."current_station_shifts" TO "anon";
GRANT ALL ON TABLE "public"."current_station_shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."current_station_shifts" TO "service_role";



GRANT ALL ON TABLE "public"."daily_summaries" TO "anon";
GRANT ALL ON TABLE "public"."daily_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_summaries" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_banners" TO "anon";
GRANT ALL ON TABLE "public"."dashboard_banners" TO "authenticated";
GRANT ALL ON TABLE "public"."dashboard_banners" TO "service_role";



GRANT ALL ON TABLE "public"."deliveries" TO "anon";
GRANT ALL ON TABLE "public"."deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."device_commands" TO "anon";
GRANT ALL ON TABLE "public"."device_commands" TO "authenticated";
GRANT ALL ON TABLE "public"."device_commands" TO "service_role";



GRANT ALL ON TABLE "public"."device_tokens" TO "anon";
GRANT ALL ON TABLE "public"."device_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."device_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."devices" TO "anon";
GRANT ALL ON TABLE "public"."devices" TO "authenticated";
GRANT ALL ON TABLE "public"."devices" TO "service_role";



GRANT ALL ON TABLE "public"."edge_rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."edge_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."edge_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."file_uploads" TO "anon";
GRANT ALL ON TABLE "public"."file_uploads" TO "authenticated";
GRANT ALL ON TABLE "public"."file_uploads" TO "service_role";



GRANT ALL ON TABLE "public"."firmware_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."firmware_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."firmware_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."fuel_stations" TO "anon";
GRANT ALL ON TABLE "public"."fuel_stations" TO "authenticated";
GRANT ALL ON TABLE "public"."fuel_stations" TO "service_role";



GRANT ALL ON TABLE "public"."fuel_transactions" TO "anon";
GRANT ALL ON TABLE "public"."fuel_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."fuel_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."global_announcements" TO "anon";
GRANT ALL ON TABLE "public"."global_announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."global_announcements" TO "service_role";



GRANT ALL ON TABLE "public"."internal_api_keys" TO "anon";
GRANT ALL ON TABLE "public"."internal_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."internal_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."knowledge_base" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_base" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_base" TO "service_role";



GRANT ALL ON TABLE "public"."sensor_readings_legacy" TO "anon";
GRANT ALL ON TABLE "public"."sensor_readings_legacy" TO "authenticated";
GRANT ALL ON TABLE "public"."sensor_readings_legacy" TO "service_role";



GRANT ALL ON TABLE "public"."latest_sensor_readings" TO "anon";
GRANT ALL ON TABLE "public"."latest_sensor_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."latest_sensor_readings" TO "service_role";



GRANT ALL ON TABLE "public"."loss_reviews" TO "anon";
GRANT ALL ON TABLE "public"."loss_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."loss_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."market_action_queue" TO "anon";
GRANT ALL ON TABLE "public"."market_action_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."market_action_queue" TO "service_role";



GRANT ALL ON TABLE "public"."market_bookmarks" TO "anon";
GRANT ALL ON TABLE "public"."market_bookmarks" TO "authenticated";
GRANT ALL ON TABLE "public"."market_bookmarks" TO "service_role";



GRANT ALL ON TABLE "public"."market_news" TO "anon";
GRANT ALL ON TABLE "public"."market_news" TO "authenticated";
GRANT ALL ON TABLE "public"."market_news" TO "service_role";



GRANT ALL ON TABLE "public"."market_prices" TO "anon";
GRANT ALL ON TABLE "public"."market_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."market_prices" TO "service_role";



GRANT ALL ON TABLE "public"."market_signals" TO "anon";
GRANT ALL ON TABLE "public"."market_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."market_signals" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_leads" TO "anon";
GRANT ALL ON TABLE "public"."marketing_leads" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_leads" TO "service_role";



GRANT ALL ON TABLE "public"."newsletter_templates" TO "anon";
GRANT ALL ON TABLE "public"."newsletter_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."newsletter_templates" TO "service_role";



GRANT ALL ON TABLE "public"."paystack_config" TO "anon";
GRANT ALL ON TABLE "public"."paystack_config" TO "authenticated";
GRANT ALL ON TABLE "public"."paystack_config" TO "service_role";



GRANT ALL ON TABLE "public"."pending_registrations" TO "service_role";
GRANT INSERT ON TABLE "public"."pending_registrations" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."pending_registrations" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."raw_market_data" TO "anon";
GRANT ALL ON TABLE "public"."raw_market_data" TO "authenticated";
GRANT ALL ON TABLE "public"."raw_market_data" TO "service_role";



GRANT ALL ON TABLE "public"."regulatory_notices" TO "anon";
GRANT ALL ON TABLE "public"."regulatory_notices" TO "authenticated";
GRANT ALL ON TABLE "public"."regulatory_notices" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."rss_cache" TO "anon";
GRANT ALL ON TABLE "public"."rss_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."rss_cache" TO "service_role";



GRANT ALL ON TABLE "public"."scraper_rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."scraper_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."scraper_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."sensor_readings" TO "anon";
GRANT ALL ON TABLE "public"."sensor_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."sensor_readings" TO "service_role";



GRANT ALL ON TABLE "public"."sensor_readings_default" TO "anon";
GRANT ALL ON TABLE "public"."sensor_readings_default" TO "authenticated";
GRANT ALL ON TABLE "public"."sensor_readings_default" TO "service_role";



GRANT ALL ON TABLE "public"."sensor_readings_y2026m05" TO "anon";
GRANT ALL ON TABLE "public"."sensor_readings_y2026m05" TO "authenticated";
GRANT ALL ON TABLE "public"."sensor_readings_y2026m05" TO "service_role";



GRANT ALL ON TABLE "public"."sensor_readings_y2026m06" TO "anon";
GRANT ALL ON TABLE "public"."sensor_readings_y2026m06" TO "authenticated";
GRANT ALL ON TABLE "public"."sensor_readings_y2026m06" TO "service_role";



GRANT ALL ON TABLE "public"."sensor_readings_y2026m07" TO "anon";
GRANT ALL ON TABLE "public"."sensor_readings_y2026m07" TO "authenticated";
GRANT ALL ON TABLE "public"."sensor_readings_y2026m07" TO "service_role";



GRANT ALL ON TABLE "public"."shift_closures" TO "anon";
GRANT ALL ON TABLE "public"."shift_closures" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_closures" TO "service_role";



GRANT ALL ON TABLE "public"."sites" TO "anon";
GRANT ALL ON TABLE "public"."sites" TO "authenticated";
GRANT ALL ON TABLE "public"."sites" TO "service_role";



GRANT ALL ON TABLE "public"."supply_risks" TO "anon";
GRANT ALL ON TABLE "public"."supply_risks" TO "authenticated";
GRANT ALL ON TABLE "public"."supply_risks" TO "service_role";



GRANT ALL ON TABLE "public"."support_categories" TO "anon";
GRANT ALL ON TABLE "public"."support_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."support_categories" TO "service_role";



GRANT ALL ON TABLE "public"."support_tickets" TO "anon";
GRANT ALL ON TABLE "public"."support_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."support_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."system_notifications" TO "anon";
GRANT ALL ON TABLE "public"."system_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."system_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."system_tasks" TO "anon";
GRANT ALL ON TABLE "public"."system_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."system_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."system_users" TO "anon";
GRANT ALL ON TABLE "public"."system_users" TO "authenticated";
GRANT ALL ON TABLE "public"."system_users" TO "service_role";



GRANT ALL ON TABLE "public"."tank_analytics_30d" TO "service_role";



GRANT ALL ON TABLE "public"."tanks" TO "anon";
GRANT ALL ON TABLE "public"."tanks" TO "authenticated";
GRANT ALL ON TABLE "public"."tanks" TO "service_role";



GRANT ALL ON TABLE "public"."team_member_requests" TO "anon";
GRANT ALL ON TABLE "public"."team_member_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."team_member_requests" TO "service_role";



GRANT ALL ON TABLE "public"."telemetry_history" TO "anon";
GRANT ALL ON TABLE "public"."telemetry_history" TO "authenticated";
GRANT ALL ON TABLE "public"."telemetry_history" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_messages" TO "anon";
GRANT ALL ON TABLE "public"."ticket_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_messages" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events" TO "anon";
GRANT ALL ON TABLE "public"."unified_events" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events_2026_03" TO "anon";
GRANT ALL ON TABLE "public"."unified_events_2026_03" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events_2026_03" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events_2026_04" TO "anon";
GRANT ALL ON TABLE "public"."unified_events_2026_04" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events_2026_04" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events_2026_05" TO "anon";
GRANT ALL ON TABLE "public"."unified_events_2026_05" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events_2026_05" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events_2026_06" TO "anon";
GRANT ALL ON TABLE "public"."unified_events_2026_06" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events_2026_06" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events_2026_08" TO "anon";
GRANT ALL ON TABLE "public"."unified_events_2026_08" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events_2026_08" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events_2026_09" TO "anon";
GRANT ALL ON TABLE "public"."unified_events_2026_09" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events_2026_09" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events_2026_10" TO "anon";
GRANT ALL ON TABLE "public"."unified_events_2026_10" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events_2026_10" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events_2026_11" TO "anon";
GRANT ALL ON TABLE "public"."unified_events_2026_11" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events_2026_11" TO "service_role";



GRANT ALL ON TABLE "public"."unified_events_pre_partition" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."unified_events_pre_partition" TO "authenticated";
GRANT ALL ON TABLE "public"."unified_events_pre_partition" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."user_push_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_push_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."volume_lookup_tables" TO "anon";
GRANT ALL ON TABLE "public"."volume_lookup_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."volume_lookup_tables" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "internal"."handle_new_user"();



CREATE OR REPLACE TRIGGER "on_auth_user_deleted" BEFORE DELETE ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "internal"."handle_user_deletion"();



CREATE POLICY "Authenticated users can delete own logos" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'profile-photos'::"text") AND (("storage"."foldername"("name"))[1] = 'organizations'::"text") AND (("storage"."foldername"("name"))[2] = ( SELECT ("profiles"."station_id")::"text" AS "client_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())
 LIMIT 1))));



CREATE POLICY "Authenticated users can delete own uploads" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'uploads'::"text") AND ("owner" = "auth"."uid"())));



CREATE POLICY "Authenticated users can update own logos" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'profile-photos'::"text") AND (("storage"."foldername"("name"))[1] = 'organizations'::"text") AND (("storage"."foldername"("name"))[2] = ( SELECT ("profiles"."station_id")::"text" AS "client_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())
 LIMIT 1))));



CREATE POLICY "Authenticated users can update own uploads" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'uploads'::"text") AND ("owner" = "auth"."uid"())));



CREATE POLICY "Authenticated users can upload files" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (("bucket_id" = 'uploads'::"text"));



CREATE POLICY "Authenticated users can upload logos" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'profile-photos'::"text") AND (("storage"."foldername"("name"))[1] = 'organizations'::"text") AND (("storage"."foldername"("name"))[2] = ( SELECT ("profiles"."station_id")::"text" AS "client_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())
 LIMIT 1))));



CREATE POLICY "Public read for profile photos" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'profile-photos'::"text"));



CREATE POLICY "Strict photo viewing" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'profile-photos'::"text") AND ((("storage"."foldername"("name"))[2] = ("auth"."uid"())::"text") OR (("storage"."foldername"("name"))[2] = ( SELECT ("profiles"."station_id")::"text" AS "station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM "public"."system_users"
  WHERE ("system_users"."auth_user_id" = "auth"."uid"()))))));



CREATE POLICY "System users can manage all branding" ON "storage"."objects" TO "authenticated" USING ((("bucket_id" = 'profile-photos'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."system_users"
  WHERE ("system_users"."auth_user_id" = "auth"."uid"()))))) WITH CHECK ((("bucket_id" = 'profile-photos'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."system_users"
  WHERE ("system_users"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "Users can list their own profile photos" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'profile-photos'::"text") AND (("auth"."uid"())::"text" = ("storage"."foldername"("name"))[1])));



CREATE POLICY "Users can manage own folder" ON "storage"."objects" TO "authenticated" USING ((("bucket_id" = 'profile-photos'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "Users can manage their own avatar" ON "storage"."objects" TO "authenticated" USING ((("bucket_id" = 'profile-photos'::"text") AND (("storage"."foldername"("name"))[1] = 'users'::"text") AND (("storage"."foldername"("name"))[2] = ("auth"."uid"())::"text"))) WITH CHECK ((("bucket_id" = 'profile-photos'::"text") AND (("storage"."foldername"("name"))[1] = 'users'::"text") AND (("storage"."foldername"("name"))[2] = ("auth"."uid"())::"text")));



CREATE POLICY "Users can manage their station branding" ON "storage"."objects" TO "authenticated" USING ((("bucket_id" = 'profile-photos'::"text") AND (("storage"."foldername"("name"))[1] = 'stations'::"text") AND (("storage"."foldername"("name"))[2] = ( SELECT ("profiles"."station_id")::"text" AS "station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())
 LIMIT 1)))) WITH CHECK ((("bucket_id" = 'profile-photos'::"text") AND (("storage"."foldername"("name"))[1] = 'stations'::"text") AND (("storage"."foldername"("name"))[2] = ( SELECT ("profiles"."station_id")::"text" AS "station_id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_user_id" = "auth"."uid"())
 LIMIT 1))));



