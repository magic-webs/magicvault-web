'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const DEFAULT_COUNTRY_CODE = '+91';

export const COUNTRY_CODES = [
  { value: '+91', label: '🇮🇳 +91' },
  { value: '+1', label: '🇺🇸 +1' },
  { value: '+44', label: '🇬🇧 +44' },
  { value: '+61', label: '🇦🇺 +61' },
  { value: '+65', label: '🇸🇬 +65' },
  { value: '+971', label: '🇦🇪 +971' },
  { value: '+49', label: '🇩🇪 +49' },
  { value: '+33', label: '🇫🇷 +33' },
  { value: '+81', label: '🇯🇵 +81' },
  { value: '+86', label: '🇨🇳 +86' },
];

/** Combines a country code and local digits into a clean numeric phone number (without +). */
export function toE164(countryCode: string, localNumber: string): string {
  return `${countryCode}${localNumber}`.replace(/\D/g, '');
}

interface PhoneInputProps {
  countryCode: string;
  onCountryCodeChange: (value: string) => void;
  localNumber: string;
  onLocalNumberChange: (value: string) => void;
  size?: 'sm' | 'md' | 'lg';
  isRequired?: boolean;
}

export function PhoneInput({
  countryCode,
  onCountryCodeChange,
  localNumber,
  onLocalNumberChange,
  isRequired,
}: PhoneInputProps) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <label className="text-sm font-medium text-foreground">
        Phone number {isRequired && <span className="text-red-500">*</span>}
      </label>
      <div className="flex gap-2">
        <Select value={countryCode} onValueChange={onCountryCodeChange}>
          <SelectTrigger className="h-10 w-28 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTRY_CODES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="tel"
          value={localNumber}
          onChange={(e) => onLocalNumberChange(e.target.value)}
          placeholder="98765 43210"
          className="flex-1"
        />
      </div>
    </div>
  );
}
