import { join } from "node:path";
import { stringify } from "yaml";
import type { GlobalConfig } from "../lib/config";
import type { Scenario } from "../lib/scenario/schema";
import {
  CKB_DOCKERFILE,
  CKB_RPC_PORT,
  CKB_SERVICE,
  DOCKER_BUILD_CONTEXT,
  FNN_BASE_DIR,
  FNN_DOCKERFILE,
  FNN_GOSSIP_NETWORK_INTERVAL_MS,
  FNN_GOSSIP_STORE_INTERVAL_MS,
  FNN_RPC_PORT,
  FNN_SECRET_KEY_PASSWORD,
  WORK_DIR,
} from "../lib/constants";

export function fnnNodeDir(runId: string, node: string): string {
  return join(process.cwd(), WORK_DIR, runId, "nodes", node);
}

interface Healthcheck {
  test: string[];
  interval: string;
  timeout: string;
  retries: number;
  start_period: string;
}

interface ComposeService {
  container_name: string;
  build: { context: string; dockerfile: string };
  networks: string[];
  restart: string;
  depends_on?: Record<string, { condition: string }>;
  environment?: Record<string, string>;
  volumes?: string[];
  command?: string[];
  ports?: string[];
  healthcheck: Healthcheck;
}

export interface ComposeProject {
  name: string;
  networks: Record<string, { name: string; driver: string }>;
  services: Record<string, ComposeService>;
}

export function networkName(config: GlobalConfig, runId: string): string {
  return `${config.dockerNetworkPrefix}_${runId}`;
}

export function containerName(config: GlobalConfig, runId: string, node: string): string {
  return `${config.dockerNetworkPrefix}_${runId}_${node}`;
}

function ckbHealthcheck(): Healthcheck {
  const body =
    '{"jsonrpc":"2.0","method":"get_tip_block_number","params":[],"id":1}';
  return {
    test: [
      "CMD-SHELL",
      `curl -sf -H 'content-type: application/json' -d '${body}' http://localhost:${CKB_RPC_PORT} || exit 1`,
    ],
    interval: "3s",
    timeout: "5s",
    retries: 20,
    start_period: "5s",
  };
}

function fnnHealthcheck(): Healthcheck {
  const body = '{"jsonrpc":"2.0","method":"node_info","params":[],"id":1}';
  return {
    test: [
      "CMD-SHELL",
      `curl -sf -H 'content-type: application/json' -d '${body}' http://$(hostname -i | awk '{print $1}'):${FNN_RPC_PORT} || exit 1`,
    ],
    interval: "3s",
    timeout: "5s",
    retries: 30,
    start_period: "15s",
  };
}

export function buildComposeProject(
  scenario: Scenario,
  runId: string,
  config: GlobalConfig,
): ComposeProject {
  if (!runId) throw new Error("buildComposeProject: runId is empty");

  if (scenario.nodes.length > config.maxNodesPerScenario) {
    throw new Error(
      `Scenario "${scenario.name}" has ${scenario.nodes.length} nodes, over maxNodesPerScenario=${config.maxNodesPerScenario} (machine-resource limit).`,
    );
  }
  if (scenario.nodes.includes(CKB_SERVICE)) {
    throw new Error(
      `Node name "${CKB_SERVICE}" collides with the CKB devnet service — rename the node in the scenario.`,
    );
  }

  const net = networkName(config, runId);
  const services: Record<string, ComposeService> = {
    [CKB_SERVICE]: {
      container_name: containerName(config, runId, CKB_SERVICE),
      build: { context: DOCKER_BUILD_CONTEXT, dockerfile: CKB_DOCKERFILE },
      networks: [net],
      restart: "unless-stopped",
      ports: [`127.0.0.1::${CKB_RPC_PORT}`],
      healthcheck: ckbHealthcheck(),
    },
  };

  for (const node of scenario.nodes) {
    services[node] = {
      container_name: containerName(config, runId, node),
      build: { context: DOCKER_BUILD_CONTEXT, dockerfile: FNN_DOCKERFILE },
      networks: [net],
      restart: "unless-stopped",
      depends_on: { [CKB_SERVICE]: { condition: "service_healthy" } },
      environment: {
        FIBER_SECRET_KEY_PASSWORD: FNN_SECRET_KEY_PASSWORD,
        FNN_RPC_PORT: String(FNN_RPC_PORT),
        FIBER_GOSSIP_NETWORK_MAINTENANCE_INTERVAL_MS: String(FNN_GOSSIP_NETWORK_INTERVAL_MS),
        FIBER_GOSSIP_STORE_MAINTENANCE_INTERVAL_MS: String(FNN_GOSSIP_STORE_INTERVAL_MS),
      },
      volumes: [`${fnnNodeDir(runId, node)}:${FNN_BASE_DIR}`],
      command: ["-d", FNN_BASE_DIR, "-c", `${FNN_BASE_DIR}/config.yml`],
      ports: [`127.0.0.1::${FNN_RPC_PORT}`],
      healthcheck: fnnHealthcheck(),
    };
  }

  return {
    name: net,
    networks: { [net]: { name: net, driver: "bridge" } },
    services,
  };
}

export function renderComposeYaml(project: ComposeProject): string {
  return stringify({
    name: project.name,
    networks: project.networks,
    services: project.services,
  });
}
