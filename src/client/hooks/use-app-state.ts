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

export function useAppState(
  enabled: boolean,
  opts?: { isAdmin?: boolean; isTenant?: boolean; isLandlord?: boolean },
) {
  const isAdmin = opts?.isAdmin ?? false;
  const isTenant = opts?.isTenant ?? false;
  const isLandlord = opts?.isLandlord ?? false;
  const [properties, setProperties] = useState<Property[]>([]);
  const [landlords, setLandlords] = useState<Landlord[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshLookups = useCallback(async () => {
    if (isTenant) {
      // Tenant shell only needs maintenance; soft-fail portfolio reads.
      setProperties([]);
      setVendors([]);
      setLandlords([]);
      setSettings(DEFAULT_SETTINGS);
      return;
    }
    if (isLandlord) {
      // Thin read-only shell: properties (RLS-scoped) + maintenance + documents list; no vendors/settings mutate.
      try {
        setProperties(await data.listProperties());
      } catch (err) {
        setProperties([]);
        setError((err as Error).message);
      }
      setVendors([]);
      setLandlords([]);
      setSettings(DEFAULT_SETTINGS);
      return;
    }
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
  }, [isTenant, isLandlord]);

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

  const requireAdmin = useCallback(() => {
    if (!isAdmin) throw new Error("Only admins can change portfolio data.");
  }, [isAdmin]);

  const createProperty = useCallback(async (input: NewProperty) => {
    requireAdmin();
    const property = await data.createProperty(input);
    await refreshLookups();
    return property;
  }, [refreshLookups, requireAdmin]);

  const updateProperty = useCallback(async (id: number, patch: Partial<NewProperty>) => {
    requireAdmin();
    const property = await data.updateProperty(id, patch);
    await refreshLookups();
    return property;
  }, [refreshLookups, requireAdmin]);

  const deleteProperty = useCallback(async (id: number) => {
    requireAdmin();
    await data.deleteProperty(id);
    await refreshLookups();
  }, [refreshLookups, requireAdmin]);

  const listUnits = useCallback(async (propertyId?: number): Promise<Unit[]> => {
    return data.listUnits(propertyId);
  }, []);

  const createUnit = useCallback(async (input: NewUnit) => {
    requireAdmin();
    const unit = await data.createUnit(input);
    await refreshLookups();
    return unit;
  }, [refreshLookups, requireAdmin]);

  const updateUnit = useCallback(async (id: number, patch: Partial<NewUnit>) => {
    requireAdmin();
    const unit = await data.updateUnit(id, patch);
    await refreshLookups();
    return unit;
  }, [refreshLookups, requireAdmin]);

  const deleteUnit = useCallback(async (id: number) => {
    requireAdmin();
    await data.deleteUnit(id);
    await refreshLookups();
  }, [refreshLookups, requireAdmin]);

  const listTenants = useCallback(async (q?: string): Promise<Tenant[]> => {
    return data.listTenants(q);
  }, []);

  const createTenant = useCallback(async (input: NewTenant) => {
    requireAdmin();
    return data.createTenant(input);
  }, [requireAdmin]);

  const updateTenant = useCallback(async (id: number, patch: Partial<NewTenant>) => {
    requireAdmin();
    return data.updateTenant(id, patch);
  }, [requireAdmin]);

  const deleteTenant = useCallback(async (id: number) => {
    requireAdmin();
    await data.deleteTenant(id);
  }, [requireAdmin]);

  const listLeases = useCallback(async (params?: {
    tenant_id?: number;
    unit_id?: number;
    status?: string;
  }): Promise<Lease[]> => {
    return data.listLeases(params);
  }, []);

  const createLease = useCallback(async (input: NewLease) => {
    requireAdmin();
    const lease = await data.createLease(input);
    await refreshLookups();
    return lease;
  }, [refreshLookups, requireAdmin]);

  const updateLease = useCallback(async (id: number, patch: Partial<NewLease>) => {
    requireAdmin();
    const lease = await data.updateLease(id, patch);
    await refreshLookups();
    return lease;
  }, [refreshLookups, requireAdmin]);

  const deleteLease = useCallback(async (id: number) => {
    requireAdmin();
    await data.deleteLease(id);
    await refreshLookups();
  }, [refreshLookups, requireAdmin]);

  const listCharges = useCallback(async (period?: string): Promise<RentCharge[]> => {
    return data.listCharges(period);
  }, []);

  const generateCharges = useCallback(async (period: string) => {
    requireAdmin();
    return data.generateCharges(period);
  }, [requireAdmin]);

  const recordPayment = useCallback(async (input: {
    charge_id: number;
    amount: number;
    method?: string;
    reference?: string | null;
    notes?: string | null;
    paid_at?: string;
  }) => {
    requireAdmin();
    return data.recordPayment(input);
  }, [requireAdmin]);

  const deletePayment = useCallback(async (paymentId: number) => {
    requireAdmin();
    return data.deletePayment(paymentId);
  }, [requireAdmin]);

  const createVendor = useCallback(async (input: NewVendor) => {
    requireAdmin();
    const vendor = await data.createVendor(input);
    await refreshLookups();
    return vendor;
  }, [refreshLookups, requireAdmin]);

  const updateVendor = useCallback(async (id: number, patch: Partial<NewVendor>) => {
    requireAdmin();
    const vendor = await data.updateVendor(id, patch);
    await refreshLookups();
    return vendor;
  }, [refreshLookups, requireAdmin]);

  const deleteVendor = useCallback(async (id: number) => {
    requireAdmin();
    await data.deleteVendor(id);
    await refreshLookups();
  }, [refreshLookups, requireAdmin]);

  const listWorkOrders = useCallback(async (params?: {
    status?: string;
    property_id?: number;
  }): Promise<WorkOrder[]> => {
    return data.listWorkOrders(params);
  }, []);

  const createWorkOrder = useCallback(async (input: NewWorkOrder) => {
    if (!isAdmin) throw new Error("Only admins can create maintenance requests.");
    return data.createWorkOrder(input);
  }, [isAdmin]);

  const submitTenantRequest = useCallback(
    async (input: Parameters<typeof data.submitTenantMaintenanceRequest>[0]) => {
      if (!isTenant) throw new Error("Only tenants can use tenant submit.");
      return data.submitTenantMaintenanceRequest(input);
    },
    [isTenant],
  );

  const updateWorkOrder = useCallback(
    async (
      id: number,
      patch: Partial<NewWorkOrder>,
      opts?: { previousStatus?: WorkOrder["status"] },
    ) => {
      if (isLandlord) throw new Error("Landlord portal is read-only.");
      if (isTenant) throw new Error("Tenants cannot edit work orders.");
      return data.updateWorkOrder(id, patch, opts);
    },
    [isLandlord, isTenant],
  );

  const deleteWorkOrder = useCallback(async (id: number) => {
    if (!isAdmin) throw new Error("Only admins can delete maintenance requests.");
    await data.deleteWorkOrder(id);
  }, [isAdmin]);

  const createLandlord = useCallback(async (input: NewLandlord) => {
    requireAdmin();
    const landlord = await data.createLandlord(input);
    await refreshLookups();
    return landlord;
  }, [refreshLookups, requireAdmin]);

  const updateLandlord = useCallback(async (id: number, patch: Partial<NewLandlord>) => {
    requireAdmin();
    const landlord = await data.updateLandlord(id, patch);
    await refreshLookups();
    return landlord;
  }, [refreshLookups, requireAdmin]);

  const deleteLandlord = useCallback(async (id: number) => {
    requireAdmin();
    await data.deleteLandlord(id);
    await refreshLookups();
  }, [refreshLookups, requireAdmin]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    requireAdmin();
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) body[k] = String(v);
    }
    const res = await data.updateSettings(body);
    setSettings(parseSettings(res));
  }, [requireAdmin]);

  return {
    isAdmin,
    isTenant,
    isLandlord,
    /** Portfolio create/update/delete (landlords, properties, rent, vendors, settings, …). */
    canMutatePortfolio: isAdmin,
    /** Admin: full MR CRUD. Maintenance staff: update assigned only (RLS). Landlord: read-only. */
    canCreateWorkOrders: isAdmin,
    canDeleteWorkOrders: isAdmin,
    /** Admin-only Accept & schedule (status Scheduled / scheduled_for). */
    canAcceptAndSchedule: isAdmin,
    /** Staff may update assigned WOs; landlord/tenant view only (tenant comments separately). */
    canEditWorkOrders: !isTenant && !isLandlord,
    properties,
    landlords,
    vendors,
    settings,
    loading,
    error,
    setError,
    notice,
    setNotice,
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
    deletePayment,
    createVendor,
    updateVendor,
    deleteVendor,
    listWorkOrders,
    createWorkOrder,
    submitTenantRequest,
    updateWorkOrder,
    deleteWorkOrder,
    createLandlord,
    updateLandlord,
    deleteLandlord,
    getProperty: data.getProperty,
    getTenant: data.getTenant,
    getDashboardSummary: data.getDashboardSummary,
    listPayments: data.listPayments,
    listMaintenancePhotos: data.listMaintenancePhotos,
    uploadMaintenancePhoto: async (...args: Parameters<typeof data.uploadMaintenancePhoto>) => {
      if (isLandlord) throw new Error("Landlord portal is read-only.");
      return data.uploadMaintenancePhoto(...args);
    },
    listMaintenanceComments: data.listMaintenanceComments,
    addMaintenanceComment: async (...args: Parameters<typeof data.addMaintenanceComment>) => {
      if (isLandlord) throw new Error("Landlord portal is read-only.");
      return data.addMaintenanceComment(...args);
    },
    listMaintenanceStatusHistory: data.listMaintenanceStatusHistory,
    listStaff: data.listStaff,
    getTenantHomeContext: data.getTenantHomeContext,
    listPropertyDocuments: data.listPropertyDocuments,
    getPropertyDocumentDownloadUrl: data.getPropertyDocumentDownloadUrl,
    uploadPropertyDocument: async (...args: Parameters<typeof data.uploadPropertyDocument>) => {
      if (isLandlord || isTenant) throw new Error("Document upload is staff-only.");
      return data.uploadPropertyDocument(...args);
    },
    updatePropertyDocumentVisibility: async (
      ...args: Parameters<typeof data.updatePropertyDocumentVisibility>
    ) => {
      if (isLandlord || isTenant) throw new Error("Document visibility is admin-only.");
      return data.updatePropertyDocumentVisibility(...args);
    },
    deletePropertyDocument: async (...args: Parameters<typeof data.deletePropertyDocument>) => {
      if (isLandlord || isTenant) throw new Error("Document delete is staff-only.");
      return data.deletePropertyDocument(...args);
    },
  };
}

export type AppStateValue = ReturnType<typeof useAppState>;
