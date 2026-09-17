-- Bridge: restore support_tickets.category and assigned_to columns the app
-- already selects/writes (SupportTickets renderCategories groups by category,
-- the create form submits category, and the Ticket interface defines assigned_to).
ALTER TABLE public.support_tickets
    ADD COLUMN IF NOT EXISTS category text,
    ADD COLUMN IF NOT EXISTS assigned_to uuid;