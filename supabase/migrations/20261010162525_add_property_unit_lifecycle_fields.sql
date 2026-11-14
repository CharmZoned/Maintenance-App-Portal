
ALTER TABLE public."Units"
 ADD COLUMN management_status text NOT NULL DEFAULT 'Active' CHECK (management_status IN ('Active','No Longer Managed')),
 ADD COLUMN occupancy_status text GENERATED ALWAYS AS (CASE WHEN status='Occupied' THEN 'Occupied' ELSE 'Unoccupied' END) STORED,
 ADD COLUMN readiness_status text NOT NULL DEFAULT 'Ready' CHECK (readiness_status IN ('Ready','Turnover Needed','Turnover In Progress','Rehab Needed','Rehab In Progress')),
 ADD COLUMN currently_being_marketed boolean NOT NULL DEFAULT false,
 ADD COLUMN management_end_date date,
 ADD COLUMN expected_move_out_date date,
 ADD CONSTRAINT units_no_marketing_during_rehab CHECK (NOT currently_being_marketed OR readiness_status NOT IN ('Rehab Needed','Rehab In Progress')),
 ADD CONSTRAINT units_no_marketing_when_unmanaged CHECK (NOT currently_being_marketed OR management_status='Active');
ALTER TABLE public."Properties"
 ADD COLUMN management_status text NOT NULL DEFAULT 'Active' CHECK (management_status IN ('Active','Partially Managed','No Longer Managed')),
 ADD COLUMN occupancy_status text NOT NULL DEFAULT 'Not Applicable' CHECK (occupancy_status IN ('Fully Occupied','Partially Occupied','Unoccupied','Not Applicable')),
 ADD COLUMN management_end_date date;
CREATE FUNCTION public.refresh_property_unit_statuses() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE pid bigint; total_units bigint; active_units bigint; occupied_units bigint;
BEGIN
 FOR pid IN SELECT DISTINCT v FROM unnest(ARRAY[
 CASE WHEN TG_OP<>'INSERT' THEN OLD.property_id ELSE NULL END,
 CASE WHEN TG_OP<>'DELETE' THEN NEW.property_id ELSE NULL END]) v WHERE v IS NOT NULL ORDER BY v
 LOOP
  PERFORM 1 FROM public."Properties" WHERE id=pid FOR UPDATE;
  SELECT count(*),count(*) FILTER(WHERE management_status='Active'),count(*) FILTER(WHERE management_status='Active' AND status='Occupied')
  INTO total_units,active_units,occupied_units FROM public."Units" WHERE property_id=pid;
  UPDATE public."Properties" SET
   management_status=CASE WHEN total_units=0 THEN management_status WHEN active_units=0 THEN 'No Longer Managed' WHEN active_units=total_units THEN 'Active' ELSE 'Partially Managed' END,
   occupancy_status=CASE WHEN active_units=0 THEN 'Not Applicable' WHEN occupied_units=active_units THEN 'Fully Occupied' WHEN occupied_units=0 THEN 'Unoccupied' ELSE 'Partially Occupied' END
  WHERE id=pid;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.refresh_property_unit_statuses() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER refresh_property_unit_statuses AFTER INSERT OR UPDATE OF property_id,status,management_status OR DELETE ON public."Units" FOR EACH ROW EXECUTE FUNCTION public.refresh_property_unit_statuses();
UPDATE public."Properties" p SET
 management_status=CASE WHEN c.active_units=0 THEN 'No Longer Managed' WHEN c.active_units=c.total_units THEN 'Active' ELSE 'Partially Managed' END,
 occupancy_status=CASE WHEN c.active_units=0 THEN 'Not Applicable' WHEN c.occupied_units=c.active_units THEN 'Fully Occupied' WHEN c.occupied_units=0 THEN 'Unoccupied' ELSE 'Partially Occupied' END
FROM (SELECT property_id,count(*) total_units,count(*) FILTER(WHERE management_status='Active') active_units,count(*) FILTER(WHERE management_status='Active' AND status='Occupied') occupied_units FROM public."Units" GROUP BY property_id) c WHERE p.id=c.property_id;
