import { useGT } from "gt-react-native";
import { View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";

/** Marks a thread that another thread's agent started, so it does not read as the user's own. */
export function AgentStartedIcon({ selected = false }: { readonly selected?: boolean }) {
  const gt = useGT();
  return (
    <View accessible accessibilityLabel={gt("Started by an agent")}>
      <SymbolView
        name="robot"
        size={11}
        tintColorClassName={
          selected ? "accent-user-bubble-foreground-muted" : "accent-foreground-muted"
        }
        type="monochrome"
      />
    </View>
  );
}
