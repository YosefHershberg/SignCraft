'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createOrderSchema } from '@/lib/domain/schemas';
import { cn } from '@/lib/utils';

export const LABELS = {
  title: 'Title',
  customerName: 'Customer name',
  signType: 'Sign type',
  widthCm: 'Width cm',
  heightCm: 'Height cm',
  quantity: 'Qty',
  vendorId: 'Vendor',
  installAddress: 'Install address',
  dueDate: 'Due date',
  notes: 'Notes',
} as const;

export type FieldName = keyof typeof LABELS;
/** The form holds every field as a string; `coerce` puts it back into schema shape. */
export type Values = Record<FieldName, string>;

export const EMPTY_VALUES: Values = {
  title: '',
  customerName: '',
  signType: '',
  widthCm: '',
  heightCm: '',
  quantity: '1',
  vendorId: '',
  installAddress: '',
  dueDate: '',
  notes: '',
};

const NUMERIC: FieldName[] = ['widthCm', 'heightCm', 'quantity'];

export const FIELD_INPUT_CLASS =
  'h-auto rounded-[8px] border-slate-300 px-2.5 py-2 text-[14px] leading-5 shadow-none aria-invalid:border-[#DC2626]';

export function coerce(name: FieldName, values: Values): unknown {
  if (NUMERIC.includes(name)) return values[name] === '' ? Number.NaN : Number(values[name]);
  if (name === 'notes') return values.notes.trim() ? values.notes : null;
  return values[name];
}

export function buildInput(values: Values): Record<string, unknown> {
  return Object.fromEntries((Object.keys(LABELS) as FieldName[]).map((name) => [name, coerce(name, values)]));
}

/**
 * Per-field validation (UI spec §4.5: "validation inline on blur"). An empty
 * field gets the design's "X is required." copy; anything else falls back to
 * Zod's own message so max-length and range rules still read sensibly.
 */
export function fieldError(name: FieldName, values: Values): string | null {
  const result = createOrderSchema.shape[name].safeParse(coerce(name, values));
  if (result.success) return null;
  if (values[name].trim() === '') return `${LABELS[name]} is required.`;
  return result.error.issues[0]?.message ?? `${LABELS[name]} is invalid.`;
}

/** The id of a field's error message; controls point at it with `aria-describedby`. */
export function fieldErrorId(name: FieldName): string {
  return `order-${name}-error`;
}

export function Field({
  name,
  error,
  optional,
  className,
  children,
}: {
  name: FieldName;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label
        htmlFor={`order-${name}`}
        className="text-[11px] leading-4 font-semibold tracking-[0.04em] text-slate-600 uppercase"
      >
        {LABELS[name]}
        {optional && <span className="ml-1 font-normal tracking-normal text-slate-400 normal-case">optional</span>}
      </label>
      {children}
      {error && (
        <span id={fieldErrorId(name)} className="text-[11px] leading-4 text-[#DC2626]">
          {error}
        </span>
      )}
    </div>
  );
}

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A picked calendar day is stored as noon UTC of that day, so every viewer —
 * whatever their offset — reads back the same calendar date. `toISOString()` on
 * the picker's local-midnight Date would shift the day for anyone west of UTC.
 */
export function calendarDayToIso(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12)).toISOString();
}

/** The inverse: the stored day as a local Date, which is what the picker compares. */
export function isoToCalendarDay(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

/** A Shadcn Select bound to one form field. Selects never blur, so they validate on change. */
export function SelectField({
  name,
  value,
  error,
  options,
  onChange,
}: {
  name: FieldName;
  value: string;
  error?: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={`order-${name}`}
        aria-invalid={!!error}
        aria-describedby={error ? fieldErrorId(name) : undefined}
        className={cn(FIELD_INPUT_CLASS, 'w-full')}
      >
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Calendar in a Popover; the value is an ISO string so it drops straight into the schema. */
export function DateField({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string | null;
  onChange: (iso: string) => void;
}) {
  const day = isoToCalendarDay(value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id="order-dueDate"
          type="button"
          variant="outline"
          aria-invalid={!!error}
          aria-describedby={error ? fieldErrorId('dueDate') : undefined}
          className={cn(FIELD_INPUT_CLASS, 'w-full justify-start border font-normal', !value && 'text-slate-400')}
        >
          {day ? longDate.format(day) : 'Pick a date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={day} onSelect={(date) => onChange(date ? calendarDayToIso(date) : '')} />
      </PopoverContent>
    </Popover>
  );
}
