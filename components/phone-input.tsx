'use client';

import { Input } from '@/components/ui/input';

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

/** Combines a country code and local digits into an E.164 phone number. */
export function toE164(countryCode: string, localNumber: string): string {
  return `${countryCode}${localNumber.replace(/\D/g, '')}`;
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
        <select
          value={countryCode}
          onChange={(e) => onCountryCodeChange(e.target.value)}
          className="flex h-10 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
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
