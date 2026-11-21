import { View } from 'react-native';
import { IconLogout } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useCommand } from '../shared/data';
import { RequestSheet } from '../shared/request-sheet';
import { Button, ErrorNotice, Hint } from '../shared/ui';
import { useAuth } from './auth-context';

export function LogoutConfirmation({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const command = useCommand();
  return (
    <RequestSheet
      visible
      variant="compact"
      title={t('profile.logoutConfirmTitle')}
      icon={<IconLogout size={23} color={colors.danger} />}
      busy={command.isPending}
      onClose={onClose}
      footer={
        <View style={{ gap: 10 }}>
          <ErrorNotice error={command.error} />
          <Button
            label={t('common.logout')}
            disabled={command.isPending}
            onPress={() => command.mutate(() => session.logout())}
          />
          <Button
            secondary
            label={t('common.cancel')}
            disabled={command.isPending}
            onPress={onClose}
          />
        </View>
      }
    >
      <Hint>{t('profile.logoutConfirmMessage')}</Hint>
    </RequestSheet>
  );
}
