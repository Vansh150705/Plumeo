import * as React from 'react';
import { cn } from '@/lib/utils';

/** Native <select> styled to match inputs: fully keyboard/screen-reader accessible and mobile-friendly. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn('flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50', className)} {...props}>{children}</select>
));
Select.displayName = 'Select';
