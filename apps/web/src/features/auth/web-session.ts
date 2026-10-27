import {
  ApiError,
  SmartSiteManagementClient,
  registerSessionCredential,
  unregisterSessionCredential,
  type LoginResponse,
  type ManagementSession,
} from '@smartsite/api-client';

type Snapshot = {
  token: string | null;
  sessionScope: string;
  response: LoginResponse | null;
  epoch: number;
  expired: boolean;
  logoutUnconfirmed: boolean;
  passwordChanged: boolean;
};
const cancelled = () => new ApiError('cancelled', 'Session changed.');

/** Owns only the in-memory credential lifecycle; server data remains in TanStack Query. */
export class WebSession {
  private snapshot: Snapshot = {
    token: null,
    sessionScope: '',
    response: null,
    epoch: 0,
    expired: false,
    logoutUnconfirmed: false,
    passwordChanged: false,
  };
  private locallySignedOut = false;
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private pendingRefresh?: Promise<LoginResponse>;
  private channel?: BroadcastChannel;
  private connected = false;
  private readonly name: string;
  private readonly legacyLogoutKey: string;

  constructor(
    apiUrl: string,
    private readonly client = new SmartSiteManagementClient(apiUrl),
  ) {
    this.name = `smartsite:auth:${apiUrl.replace(/\/+$/, '')}`;
    this.legacyLogoutKey = `smartsite:logout:${apiUrl.replace(/\/+$/, '')}`;
  }
  getSnapshot = () => this.snapshot;
  canRestore = () => !this.signedOut();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  private signedOut(value?: boolean) {
    if (value !== undefined) this.locallySignedOut = value;
    try {
      if (value === true) localStorage.setItem(`${this.name}:signed-out`, 'true');
      if (value === false) {
        localStorage.removeItem(`${this.name}:signed-out`);
        sessionStorage.removeItem('smartsite:signed-out');
        sessionStorage.removeItem(this.legacyLogoutKey);
      }
      return (
        this.locallySignedOut ||
        localStorage.getItem(`${this.name}:signed-out`) === 'true' ||
        sessionStorage.getItem('smartsite:signed-out') === 'true' ||
        sessionStorage.getItem(this.legacyLogoutKey) !== null
      );
    } catch {
      return this.locallySignedOut;
    }
  }
  connect() {
    this.connected = true;
    if (this.snapshot.token)
      registerSessionCredential(this.snapshot.token, this.snapshot.sessionScope);
    if (typeof BroadcastChannel === 'undefined' || this.channel) return;
    this.channel = new BroadcastChannel(this.name);
    this.channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data !== 'signed-out' && event.data !== 'changed') return;
      this.signedOut(event.data === 'signed-out');
      this.clear(false);
    };
  }
  dispose() {
    this.connected = false;
    if (this.snapshot.token)
      unregisterSessionCredential(this.snapshot.token, this.snapshot.sessionScope);
    this.channel?.close();
    this.channel = undefined;
  }
  private lock<T>(operation: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks)
      return navigator.locks.request(this.name, operation);
    return operation();
  }
  clear(expired: boolean) {
    if (this.snapshot.token)
      unregisterSessionCredential(this.snapshot.token, this.snapshot.sessionScope);
    this.controller.abort();
    this.controller = new AbortController();
    this.pendingRefresh = undefined;
    this.update({
      token: null,
      sessionScope: '',
      response: null,
      epoch: this.snapshot.epoch + 1,
      expired,
      logoutUnconfirmed: false,
      passwordChanged: false,
    });
  }
  dismissExpired() {
    this.update({ expired: false });
  }
  setAccessToken(token: string | null) {
    this.clear(false);
    if (token) {
      this.signedOut(false);
      const sessionScope = crypto.randomUUID();
      if (this.connected) registerSessionCredential(token, sessionScope);
      this.update({ token, sessionScope });
    }
  }
  accept(response: LoginResponse) {
    if (this.snapshot.token)
      unregisterSessionCredential(this.snapshot.token, this.snapshot.sessionScope);
    const sessionScope = crypto.randomUUID();
    if (this.connected) registerSessionCredential(response.accessToken, sessionScope);
    this.update({
      token: response.accessToken,
      sessionScope,
      response,
      expired: false,
      passwordChanged: false,
    });
  }
  private assertEpoch(epoch: number) {
    if (epoch !== this.snapshot.epoch) throw cancelled();
  }
  async login(username: string, password: string) {
    // An unsuccessful attempt must not write a shared logout marker for other tabs.
    this.locallySignedOut = true;
    this.clear(false);
    const epoch = this.snapshot.epoch;
    const response = await this.lock(async () => {
      this.assertEpoch(epoch);
      const result = await this.client.login(username, password, 'WEB', {
        timeoutMs: 15_000,
      });
      this.assertEpoch(epoch);
      return result;
    });
    this.signedOut(false);
    this.accept(response);
    this.channel?.postMessage('changed');
    return response;
  }
  async logout() {
    this.signOutLocally();
    const epoch = this.snapshot.epoch;
    try {
      await this.lock(() => {
        this.assertEpoch(epoch);
        return this.client.logout('WEB', undefined, { timeoutMs: 15_000 });
      });
    } catch (error) {
      if (epoch === this.snapshot.epoch) this.update({ logoutUnconfirmed: true });
      throw error;
    }
  }
  signOutLocally(passwordChanged = false) {
    this.signedOut(true);
    this.clear(false);
    if (passwordChanged) this.update({ passwordChanged: true });
    this.channel?.postMessage('signed-out');
  }
  async restore() {
    if (this.snapshot.response) return this.snapshot.response;
    if (this.signedOut()) return null;
    const epoch = this.snapshot.epoch;
    try {
      return await this.refresh();
    } catch (error) {
      this.assertEpoch(epoch);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        this.signedOut(true);
        this.clear(false);
        return null;
      }
      throw error;
    }
  }
  private refresh(): Promise<LoginResponse> {
    if (this.pendingRefresh) return this.pendingRefresh;
    const epoch = this.snapshot.epoch;
    const pending = this.lock(async () => {
      this.assertEpoch(epoch);
      // Cookie rotation must finish under the lock before a queued logout uses the cookie.
      const response = await this.client.refresh('WEB', undefined, {
        timeoutMs: 15_000,
      });
      this.assertEpoch(epoch);
      if (this.signedOut()) throw cancelled();
      if (this.snapshot.response && response.user.id !== this.snapshot.response.user.id) {
        this.clear(false);
        throw cancelled();
      }
      this.accept(response);
      return response;
    });
    this.pendingRefresh = pending;
    void pending.then(
      () => {
        if (this.pendingRefresh === pending) this.pendingRefresh = undefined;
      },
      () => {
        if (this.pendingRefresh === pending) this.pendingRefresh = undefined;
      },
    );
    return pending;
  }
  adapter(epoch = this.snapshot.epoch): ManagementSession {
    return {
      signal: epoch === this.snapshot.epoch ? this.controller.signal : AbortSignal.abort(),
      getAccessToken: () => {
        this.assertEpoch(epoch);
        if (!this.snapshot.token) throw cancelled();
        return this.snapshot.token;
      },
      refreshAccessToken: async (failedToken) => {
        this.assertEpoch(epoch);
        if (this.snapshot.token && failedToken !== this.snapshot.token) return this.snapshot.token;
        // Legacy injected tokens have no verified account binding. Reauthentication is
        // required instead of retrying their in-flight work with an unrelated cookie.
        if (this.snapshot.token && !this.snapshot.response)
          throw new ApiError('http', 'Reauthentication is required.', 401);
        return (await this.refresh()).accessToken;
      },
      onUnauthorized: (failedToken) => {
        if (epoch !== this.snapshot.epoch || failedToken !== this.snapshot.token) return;
        this.signedOut(true);
        this.clear(true);
        this.channel?.postMessage('signed-out');
      },
    };
  }
}
