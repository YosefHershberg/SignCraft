/** lib/utils.ts — the one general-purpose helper shared by `components/*`. */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class names and resolves Tailwind conflicts (last one wins). */
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
