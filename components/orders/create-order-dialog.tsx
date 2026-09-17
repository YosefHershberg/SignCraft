'use client';

// components/orders — the "New order" form. Where every order enters the
// state machine (as DRAFT): field state lives here, field rendering and the
// string↔schema coercion live in `order-form-field.tsx`, and the request goes
// through `useCreateOrder` to `POST /api/orders`, which validates the very
// same `createOrderSchema` server-side.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createOrderSchema } from '@/lib/domain/schemas';
import { SIGN_TYPE_LABEL } from '@/lib/domain/status-meta';
import { SIGN_TYPES, type OrderDTO, type VendorDTO } from '@/lib/domain/types';
import { ApiClientError } from '@/lib/query/api-client';
import { useCreateOrder } from '@/lib/query/hooks';
import { cn } from '@/lib/utils';
import { InlineError } from './inline-error';
import {
  DateField,
  EMPTY_VALUES,
  FIELD_INPUT_CLASS as INPUT,
  Field,
  SelectField,
  TextField,
  buildInput,
  fieldError,
  fieldErrorId,
  type FieldName,
  type Values,
} from './order-form-field';
import { useRestoreFocus, visibleElement } from './use-restore-focus';

/** The sign-type Select's options, built once from the domain enum so the form cannot drift from it. */
const SIGN_TYPE_OPTIONS = SIGN_TYPES.map((value) => ({ value, label: SIGN_TYPE_LABEL[value] }));

/**
 * Create Order dialog (UI spec §4.5, design 1e). Ops only.
 *
 * Validation is split in two: `fieldError` runs per field (on blur, or on
 * change for controls that never blur) to produce the inline message, while
 * `parsed` re-runs the whole `createOrderSchema` on every render to gate the
 * submit button. Both go through `buildInput`, so what is validated is exactly
 * the body that will be sent, and a form that passes here cannot fail the
 * route's `parseBody(createOrderSchema)` with a VALIDATION_ERROR.
 *
 * On success the new order lands in the cache via `setOrderInCache` (same
 * reducer as SSE), the board flashes it through `onCreated`, and the dialog
 * closes; a server error is rendered inline by `InlineError`, never toasted.
 */
export function CreateOrderDialog({
  open,
  onOpenChange,
  vendors,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendors: VendorDTO[];
  /** Fired with the new order so the board can flash its highlight ring. */
  onCreated?: (order: OrderDTO) => void;
}) {
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string | null>>>({});
  const [serverError, setServerError] = useState<ApiClientError | null>(null);
  const create = useCreateOrder();

  /** The whole form against the API schema; `success` is the only thing that enables "Create draft". */
  const parsed = createOrderSchema.safeParse(buildInput(values));

  /**
   * Updates one field. Select and Calendar never blur, so they validate on
   * change instead (`validateNow`); text inputs validate on change only once
   * they already carry an error, so a message clears as soon as the user fixes
   * the value rather than waiting for the next blur.
   */
  function set(name: FieldName, value: string, validateNow = false) {
    const next = { ...values, [name]: value };
    setValues(next);
    if (validateNow || errors[name]) setErrors((e) => ({ ...e, [name]: fieldError(name, next) }));
  }

  /** `onBlur` handler factory: the blur-time validation UI spec §4.5 asks for. */
  const blur = (name: FieldName) => () => setErrors((e) => ({ ...e, [name]: fieldError(name, values) }));

  /** Back to a pristine form; shared by the close effect below and the success path. */
  const reset = useCallback(() => {
    setValues(EMPTY_VALUES);
    setErrors({});
    setServerError(null);
  }, []);

  // The dialog stays mounted between openings, so every close path — Cancel,
  // Escape, the ✕, a click outside — has to leave the form empty. Resetting on
  // the `open → false` edge covers all of them at once.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const restoreFocus = useRestoreFocus(
    open,
    // The opener is normally the header's "New order" button; the mobile FAB is
    // the only one addressable by selector if that element is gone.
    useCallback(() => visibleElement('[aria-label="New order"]'), [])
  );

  /**
   * Sends `parsed.data` — the schema's output, not the raw strings — so the
   * body is already coerced (numbers, `notes: null`) when it hits the route.
   * The `!parsed.success` guard is belt-and-braces: the button is disabled in
   * that state.
   */
  function submit() {
    if (!parsed.success) return;
    setServerError(null);
    create.mutate(parsed.data, {
      onSuccess: (order) => {
        toast.success(`Order ${order.orderNumber} created`);
        onCreated?.(order);
        reset();
        onOpenChange(false);
      },
      onError: (err) =>
        setServerError(err instanceof ApiClientError ? err : new ApiClientError(0, 'UNKNOWN', String(err))),
    });
  }

  /** A `TextField` wired to this form's state; the three free-text fields differ only by name. */
  const text = (name: FieldName, placeholder?: string) => (
    <TextField
      name={name}
      value={values[name]}
      error={errors[name]}
      placeholder={placeholder}
      onChange={(value) => set(name, value)}
      onBlur={blur(name)}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={restoreFocus}
        className="max-h-[92vh] gap-4 overflow-y-auto rounded-[12px] p-6 sm:max-w-[560px]"
      >
        <DialogHeader className="gap-1">
          <DialogTitle className="text-[20px] leading-7 tracking-[-0.01em] text-slate-900">New order</DialogTitle>
          <DialogDescription className="text-[14px] leading-5 text-slate-600">
            Creates a draft. Files can be uploaded before submitting to a vendor.
          </DialogDescription>
        </DialogHeader>

        <Field name="title" error={errors.title}>
          {text('title')}
        </Field>
        <Field name="customerName" error={errors.customerName}>
          {text('customerName')}
        </Field>

        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3">
          <Field name="signType" error={errors.signType}>
            <SelectField
              name="signType"
              value={values.signType}
              error={errors.signType}
              options={SIGN_TYPE_OPTIONS}
              onChange={(v) => set('signType', v, true)}
            />
          </Field>

          {(['widthCm', 'heightCm', 'quantity'] as const).map((name) => (
            <Field key={name} name={name} error={errors[name]}>
              <Input
                id={`order-${name}`}
                inputMode="numeric"
                value={values[name]}
                aria-invalid={!!errors[name]}
                aria-describedby={errors[name] ? fieldErrorId(name) : undefined}
                onChange={(e) => set(name, e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={blur(name)}
                className={cn(INPUT, 'font-mono text-[13px] font-medium')}
              />
            </Field>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field name="vendorId" error={errors.vendorId}>
            <SelectField
              name="vendorId"
              value={values.vendorId}
              error={errors.vendorId}
              options={vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
              onChange={(v) => set('vendorId', v, true)}
            />
          </Field>

          <Field name="dueDate" error={errors.dueDate}>
            <DateField value={values.dueDate} error={errors.dueDate} onChange={(iso) => set('dueDate', iso, true)} />
          </Field>
        </div>

        <Field name="installAddress" error={errors.installAddress}>
          {text('installAddress', 'Street, city, postcode')}
        </Field>

        <Field name="notes" error={errors.notes} optional>
          <Textarea
            id="order-notes"
            value={values.notes}
            aria-invalid={!!errors.notes}
            aria-describedby={errors.notes ? fieldErrorId('notes') : undefined}
            onChange={(e) => set('notes', e.target.value)}
            onBlur={blur('notes')}
            className="min-h-16 resize-none rounded-[8px] border-slate-300 text-[14px] leading-5"
          />
        </Field>

        {serverError && <InlineError error={serverError} />}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-auto rounded-[8px] px-3.5 py-[9px] text-[13px] leading-[18px] font-semibold text-slate-600"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!parsed.success || create.isPending}
            onClick={submit}
            className="h-auto rounded-[8px] bg-[#0D9488] px-[18px] py-[9px] text-[13px] leading-[18px] font-semibold text-white hover:bg-[#0F766E]"
          >
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
