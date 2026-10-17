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
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const date = value && Number.isFinite(Date.parse(value)) ? new Date(value) : new Date();
  return (
    <View style={{ gap: 8 }}>
      <Hint>
        {label}: {value ? displayTime(value) : 'Chưa chọn'}
      </Hint>
      <Button secondary label={`${label} — chọn ngày`} onPress={() => setMode('date')} />
      <Button
        secondary
        label={`${label} — chọn giờ`}
        disabled={!value}
        onPress={() => setMode('time')}
      />
      {mode && (
        <>
          <DateTimePicker
            value={date}
            mode={mode}
            is24Hour
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, selected) => {
              if (Platform.OS !== 'ios') setMode(null);
              if (event.type === 'set' && selected) onChange(selected.toISOString());
            }}
          />
          {Platform.OS === 'ios' && <Button label="Xong" onPress={() => setMode(null)} />}
        </>
      )}
    </View>
  );
}
