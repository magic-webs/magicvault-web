'use client';

import { InputGroup } from '@astryxdesign/core/InputGroup';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';

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
  size = 'lg',
  isRequired,
}: PhoneInputProps) {
  return (
    <InputGroup label="Phone number" size={size} isRequired={isRequired}>
      <Selector
        label="Country code"
        isLabelHidden
        options={COUNTRY_CODES}
        value={countryCode}
        onChange={(value) => value && onCountryCodeChange(value)}
      />
      <TextInput
        label="Phone number"
        isLabelHidden
        value={localNumber}
        onChange={onLocalNumberChange}
        placeholder="98765 43210"
      />
    </InputGroup>
  );
}
