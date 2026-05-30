import * as React from 'react';
import { Pane } from '../../components/design-system/Pane.js';
import { Select } from '../../components/CustomSelect/select.js';
import { setActiveLocale } from '../../i18n/index.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';

// Option labels are autonyms (each language's own name) and are intentionally
// NOT translated. Values are the BCP 47 locale tags the catalogs key off.
const LOCALE_OPTIONS = [
  { label: 'English', value: 'en' },
  { label: '简体中文 (Simplified Chinese)', value: 'zh-Hans' },
  { label: '日本語 (Japanese)', value: 'ja' },
];

function LocalePickerCommand({
  onDone,
}: {
  onDone: (result?: string) => void;
}): React.ReactNode {
  const { t } = useTranslation();
  const current = getGlobalConfig().locale;
  const defaultValue = LOCALE_OPTIONS.some(option => option.value === current)
    ? (current as string)
    : 'en';
  return (
    <Pane color="permission">
      <Select
        options={LOCALE_OPTIONS}
        defaultValue={defaultValue}
        onChange={value => {
          saveGlobalConfig(config => ({ ...config, locale: value }));
          setActiveLocale(value);
          onDone(t('command.locale.result.set', { value }));
        }}
        onCancel={() => onDone(t('command.locale.result.dismissed'))}
      />
    </Pane>
  );
}

export const call: LocalJSXCommandCall = async onDone => {
  return <LocalePickerCommand onDone={onDone} />;
};
