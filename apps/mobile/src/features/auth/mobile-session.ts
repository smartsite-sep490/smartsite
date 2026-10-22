import { translate as tr } from '../../i18n';
import {
  ApiError,
  SmartSiteManagementClient,
  type LoginResponse,
  type ManagementSession,
} from '@smartsite/api-client';

export interface CredentialStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  remove(): Promise<void>;
}
type Snapshot = {
  response: LoginResponse | null;
  epoch: number;
  expired: boolean;
  notice: string | null;
};
const cancelled = () => new ApiError('cancelled', tr('auth.sessionChanged'));

/** Only refresh credentials are persisted; rotations, login and logout are serialized. */
export class MobileSession {
  private snapshot: Snapshot = { response: null, epoch: 0, expired: false, notice: null };
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();
  private pendingRefresh?: Promise<LoginResponse>;
  constructor(
    private store: CredentialStore,
    private client: SmartSiteManagementClient,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation, operation);
    this.queue = task.catch(() => {});
    return task;
  }
  private assertEpoch(epoch: number) {
    if (epoch !== this.snapshot.epoch) throw cancelled();
  }
  private clear(expired = false) {
    this.controller.abort();
    this.controller = new AbortController();
    this.pendingRefresh = undefined;
    this.update({ response: null, epoch: this.snapshot.epoch + 1, expired, notice: null });
  }
  private async accept(response: LoginResponse, epoch: number) {
    if (!response.refreshToken)
      throw new ApiError('invalid-response', tr('auth.mobileSessionMissing'));
    // Finish rotation under the queue even if logout happened during the request.
    // The queued logout must revoke the latest refresh token, not its consumed parent.
    try {
      await this.store.write(response.refreshToken);
    } catch (error) {
      await this.store.remove();
      this.clear(true);
      throw error;
    }
    this.assertEpoch(epoch);
    this.update({ response, expired: false });
    return response;
  }
  async login(username: string, password: string) {
    this.clear();
    const epoch = this.snapshot.epoch;
    return this.serial(async () => {
      this.assertEpoch(epoch);
      await this.store.remove();
      const result = await this.client.login(username.trim(), password, 'MOBILE', {
        timeoutMs: 15000,
      });
      return this.accept(result, epoch);
    });
  }
  restore() {
    if (this.snapshot.response) return Promise.resolve(this.snapshot.response);
    return this.refresh().catch((error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
      throw error;
    });
  }
  private refresh(): Promise<LoginResponse> {
    if (this.pendingRefresh) return this.pendingRefresh;
    const epoch = this.snapshot.epoch;
    const pending = this.serial(async () => {
      this.assertEpoch(epoch);
      const token = await this.store.read();
      this.assertEpoch(epoch);
      if (!token) throw new ApiError('http', tr('auth.signInRequired'), 401);
      try {
        const response = await this.client.refresh('MOBILE', token, { timeoutMs: 15000 });
        if (this.snapshot.response && response.user.id !== this.snapshot.response.user.id)
          throw new ApiError('http', tr('auth.accountChanged'), 401);
        return await this.accept(response, epoch);
      } catch (error) {
        if (
          epoch === this.snapshot.epoch &&
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          await this.store.remove();
          this.clear(true);
        }
        throw error;
      }
    });
    this.pendingRefresh = pending;
    void pending
      .finally(() => {
        if (this.pendingRefresh === pending) this.pendingRefresh = undefined;
      })
      .catch(() => {});
    return pending;
  }
  async logout() {
    this.clear();
    return this.serial(async () => {
      let token: string | null;
      try {
        token = await this.store.read();
      } finally {
        await this.store.remove();
      }
      try {
        if (token) await this.client.logout('MOBILE', token, { timeoutMs: 15000 });
      } catch (error) {
        this.update({
          notice: tr('auth.localSignOutNotice'),
        });
        throw error;
      }
    });
  }
  async afterPasswordChange() {
    this.clear();
    await this.serial(() => this.store.remove());
    this.update({ notice: tr('auth.passwordChangedNotice') });
  }
  adapter(epoch = this.snapshot.epoch): ManagementSession {
    return {
      signal: this.controller.signal,
      getAccessToken: () => {
        this.assertEpoch(epoch);
        const token = this.snapshot.response?.accessToken;
        if (!token) throw cancelled();
        return token;
      },
      refreshAccessToken: async (failed) => {
        this.assertEpoch(epoch);
        const current = this.snapshot.response?.accessToken;
        if (current && current !== failed) return current;
        return (await this.refresh()).accessToken;
      },
      onUnauthorized: (failed) => {
        if (epoch !== this.snapshot.epoch || failed !== this.snapshot.response?.accessToken) return;
        this.clear(true);
        void this.serial(() => this.store.remove()).catch(() => {});
      },
    };
  }
}
