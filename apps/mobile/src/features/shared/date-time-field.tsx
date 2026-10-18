import { useTranslation } from '../../i18n';
import { translate as tr, uiLocale } from '../../i18n';
import { useState } from 'react';
import { View, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button, Hint } from './ui';
import { displayTime } from './data';

export function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  useTranslation();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const date = value && Number.isFinite(Date.parse(value)) ? new Date(value) : new Date();
  return (
    <View style={{ gap: 8 }}>
      <Hint>
        {label}: {value ? displayTime(value) : tr('common.notSelected')}
      </Hint>
      <Button
        secondary
        label={tr('common.chooseDate', { label })}
        onPress={() => setMode('date')}
      />
      <Button
        secondary
        label={tr('common.chooseTime', { label })}
        disabled={!value}
        onPress={() => setMode('time')}
      />
      {mode && (
        <>
          <DateTimePicker
            locale={uiLocale()}
            value={date}
            mode={mode}
            is24Hour
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, selected) => {
              if (Platform.OS !== 'ios') setMode(null);
              if (event.type === 'set' && selected) onChange(selected.toISOString());
            }}
          />
          {Platform.OS === 'ios' && (
            <Button label={tr('common.done')} onPress={() => setMode(null)} />
          )}
        </>
      )}
    </View>
  );
}
