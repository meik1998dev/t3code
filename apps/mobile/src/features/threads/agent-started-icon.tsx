import { View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";

/** Marks a thread that another thread's agent started, so it does not read as the user's own. */
export function AgentStartedIcon({ selected = false }: { readonly selected?: boolean }) {
  return (
    <View accessible accessibilityLabel="Started by an agent">
      <SymbolView
        name="sparkles"
        size={11}
        tintColorClassName={
          selected ? "accent-user-bubble-foreground-muted" : "accent-foreground-muted"
        }
        type="monochrome"
      />
    </View>
  );
}
