import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { Button } from "@/components/Button";
import { ACCESS_LOGIN_ORIGIN, FRONTEND_URL } from "@/lib/env";
import { createStyles, spacing, type } from "@/lib/theme";
import {
  accessRevision,
  checkWorkspaceAccess,
  isWorkspaceAccessURL,
  subscribeWorkspaceAccess,
} from "@/lib/workspaceAccess";

interface Props {
  children: ReactNode;
}

export function WorkspaceAccessGate({ children }: Props) {
  const styles = useStyles();
  const revision = useSyncExternalStore(
    subscribeWorkspaceAccess,
    accessRevision,
  );
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(!!ACCESS_LOGIN_ORIGIN);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);

  async function check(): Promise<void> {
    controller.current?.abort();
    const attempt = new AbortController();
    controller.current = attempt;
    const expectedRevision = accessRevision();
    const timeout = setTimeout(() => attempt.abort(), 15_000);
    try {
      if (await checkWorkspaceAccess(attempt.signal)) {
        if (!attempt.signal.aborted && accessRevision() === expectedRevision)
          setReadyAt(expectedRevision);
      }
      if (controller.current === attempt) setError(false);
    } catch {
      if (controller.current === attempt) setError(true);
    } finally {
      clearTimeout(timeout);
      if (controller.current === attempt) setChecking(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    if (ACCESS_LOGIN_ORIGIN)
      void Promise.resolve().then(() => {
        if (!disposed) return check();
      });
    return () => {
      disposed = true;
      controller.current?.abort();
      controller.current = null;
    };
  }, [revision]);

  function handleLoadEnd(): void {
    void check();
  }

  if (!ACCESS_LOGIN_ORIGIN) return children;
  const ready = readyAt === revision;
  return (
    <>
      {readyAt !== null ? children : null}
      <Modal
        visible={!ready}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <SafeAreaView style={styles.screen}>
          <View style={styles.heading}>
            <Text style={styles.title}>Unlock your private workspace</Text>
            <Text style={styles.description}>
              Use your approved email to continue.
            </Text>
            {error ? (
              <Text style={styles.description}>
                Couldn’t reach your workspace. Try again.
              </Text>
            ) : null}
            <Button label="Check access" onPress={() => void check()} />
          </View>
          {checking ? (
            <ActivityIndicator />
          ) : (
            <WebView
              source={{ uri: `${FRONTEND_URL}/api/auth/ok` }}
              style={styles.browser}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled={false}
              originWhitelist={[
                new URL(FRONTEND_URL).origin,
                ACCESS_LOGIN_ORIGIN,
              ]}
              onShouldStartLoadWithRequest={(request) =>
                request.isTopFrame === false ||
                isWorkspaceAccessURL(request.url)
              }
              onLoadEnd={handleLoadEnd}
              onError={() => setError(true)}
              setSupportMultipleWindows={false}
            />
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const useStyles = createStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  browser: { flex: 1 },
  heading: { padding: spacing.lg, gap: spacing.sm },
  title: { ...type.heading, color: colors.text },
  description: { ...type.body, color: colors.textSecondary },
}));
