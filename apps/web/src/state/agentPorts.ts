import { createAgentPortsEnvironmentAtoms } from "@t3tools/client-runtime/state/agentPorts";
import { connectionAtomRuntime } from "../connection/runtime";

export const agentPortsEnvironment = createAgentPortsEnvironmentAtoms(connectionAtomRuntime);
