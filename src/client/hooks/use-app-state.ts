import { useCallback, useEffect, useState } from "react";
import * as data from "../lib/data";
import type {
  Property,
  Unit,
  Tenant,
  Lease,
  RentCharge,
  Vendor,
  WorkOrder,
  Landlord,
  NewProperty,
  NewUnit,
  NewTenant,
  NewLease,
  NewWorkOrder,
  NewVendor,
  NewLandlord,
} from "../types";

export interface AppSettings {
  default_rent_due_day: number;
  late_fee_amount: number;
  late_fee_grace_days: number;
  currency: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  default_rent_due_day: 1,
  late_fee_amount: 50,
  late_fee_grace_days: 5,
  currency: "USD",
};

function parseSettings(raw: Record<string, string>): AppSettings {
  const num = (key: keyof AppSettings, fallback: number) => {
    const v = parseFloat(raw[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    default_rent_due_day: num("default_rent_due_day", DEFAULT_SETTINGS.default_rent_due_day),
    late_fee_amount: num("late_fee_amount", DEFAULT_SETTINGS.late_fee_amount),
    late_fee_grace_days: num("late_fee_grace_days", DEFAULT_SETTINGS.late_fee_grace_days),
    currency: raw.currency || DEFAULT_SETTINGS.currency,
  };
}

export function useAppState(enabled: boolean) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [landlords, setLandlords] = useState<Landlord[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshLookups = useCallback(async () => {
    const [props, vens, st, lls] = await Promise.all([
      data.listProperties(),
      data.listVendors().catch(() => [] as Vendor[]),
      data.getSettings().catch(() => ({} as Record<string, string>)),
      data.listLandlords().catch(() => [] as Landlord[]),
    ]);
    setProperties(props);
    setVendors(vens);
    setSettings(parseSettings(st));
    setLandlords(lls);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) body[k] = String(v);
    }
    const res = await data.updateSettings(body);
    setSettings(parseSettings(res));
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        await refreshLookups();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshLookups, enabled]);

  const createProperty = useCallback(async (input: NewProperty) => {
    const property = await data.createProperty(input);
    await refreshLookups();
    return property;
  }, [refreshLookups]);

  const updateProperty = useCallback(async (id: number, patch: Partial<NewProperty>) => {
    const property = await data.updateProperty(id, patch);
    await refreshLookups();
    return property;
  }, [refreshLookups]);

  const deleteProperty = useCallback(async (id: number) => {
    await data.deleteProperty(id);
    await refreshLookups();
  }, [refreshLookups]);

  const listUnits = useCallback(async (propertyId?: number): Promise<Unit[]> => {
    return data.listUnits(propertyId);
  }, []);

  const createUnit = useCallback(async (input: NewUnit) => {
    const unit = await data.createUnit(input);
    await refreshLookups();
    return unit;
  }, [refreshLookups]);

  const updateUnit = useCallback(async (id: number, patch: Partial<NewUnit>) => {
    const unit = await data.updateUnit(id, patch);
    await refreshLookups();
    return unit;
  }, [refreshLookups]);

  const deleteUnit = useCallback(async (id: number) => {
    await data.deleteUnit(id);
    await refreshLookups();
  }, [refreshLookups]);

  const listTenants = useCallback(async (q?: string): Promise<Tenant[]> => {
    return data.listTenants(q);
  }, []);

  const createTenant = useCallback(async (input: NewTenant) => {
    return data.createTenant(input);
  }, []);

  const updateTenant = useCallback(async (id: number, patch: Partial<NewTenant>) => {
    return data.updateTenant(id, patch);
  }, []);

  const deleteTenant = useCallback(async (id: number) => {
    await data.deleteTenant(id);
  }, []);

  const listLeases = useCallback(async (params?: {
    tenant_id?: number;
    unit_id?: number;
    status?: string;
  }): Promise<Lease[]> => {
    return data.listLeases(params);
  }, []);

  const createLease = useCallback(async (input: NewLease) => {
    const lease = await data.createLease(input);
    await refreshLookups();
    return lease;
  }, [refreshLookups]);

  const updateLease = useCallback(async (id: number, patch: Partial<NewLease>) => {
    const lease = await data.updateLease(id, patch);
    await refreshLookups();
    return lease;
  }, [refreshLookups]);

  const deleteLease = useCallback(async (id: number) => {
    await data.deleteLease(id);
    await refreshLookups();
  }, [refreshLookups]);

  const listCharges = useCallback(async (period?: string): Promise<RentCharge[]> => {
    return data.listCharges(period);
  }, []);

  const generateCharges = useCallback(async (period: string) => {
    return data.generateCharges(period);
  }, []);

  const recordPayment = useCallback(async (input: {
    charge_id: number;
    amount: number;
    method?: string;
    reference?: string | null;
    notes?: string | null;
    paid_at?: string;
  }) => {
    return data.recordPayment(input);
  }, []);

  const createVendor = useCallback(async (input: NewVendor) => {
    const vendor = await data.createVendor(input);
    await refreshLookups();
    return vendor;
  }, [refreshLookups]);

  const updateVendor = useCallback(async (id: number, patch: Partial<NewVendor>) => {
    const vendor = await data.updateVendor(id, patch);
    await refreshLookups();
    return vendor;
  }, [refreshLookups]);

  const deleteVendor = useCallback(async (id: number) => {
    await data.deleteVendor(id);
    await refreshLookups();
  }, [refreshLookups]);

  const listWorkOrders = useCallback(async (params?: {
    status?: string;
    property_id?: number;
  }): Promise<WorkOrder[]> => {
    return data.listWorkOrders(params);
  }, []);

  const createWorkOrder = useCallback(async (input: NewWorkOrder) => {
    return data.createWorkOrder(input);
  }, []);

  const updateWorkOrder = useCallback(async (id: number, patch: Partial<NewWorkOrder>) => {
    return data.updateWorkOrder(id, patch);
  }, []);

  const deleteWorkOrder = useCallback(async (id: number) => {
    await data.deleteWorkOrder(id);
  }, []);

  const createLandlord = useCallback(async (input: NewLandlord) => {
    const landlord = await data.createLandlord(input);
    await refreshLookups();
    return landlord;
  }, [refreshLookups]);

  const updateLandlord = useCallback(async (id: number, patch: Partial<NewLandlord>) => {
    const landlord = await data.updateLandlord(id, patch);
    await refreshLookups();
    return landlord;
  }, [refreshLookups]);

  const deleteLandlord = useCallback(async (id: number) => {
    await data.deleteLandlord(id);
    await refreshLookups();
  }, [refreshLookups]);

  return {
    properties,
    landlords,
    vendors,
    settings,
    loading,
    error,
    setError,
    refreshLookups,
    updateSettings,
    createProperty,
    updateProperty,
    deleteProperty,
    listUnits,
    createUnit,
    updateUnit,
    deleteUnit,
    listTenants,
    createTenant,
    updateTenant,
    deleteTenant,
    listLeases,
    createLease,
    updateLease,
    deleteLease,
    listCharges,
    generateCharges,
    recordPayment,
    createVendor,
    updateVendor,
    deleteVendor,
    listWorkOrders,
    createWorkOrder,
    updateWorkOrder,
    deleteWorkOrder,
    createLandlord,
    updateLandlord,
    deleteLandlord,
    getProperty: data.getProperty,
    getTenant: data.getTenant,
    getDashboardSummary: data.getDashboardSummary,
    listPayments: data.listPayments,
  };
}

export type AppStateValue = ReturnType<typeof useAppState>;
