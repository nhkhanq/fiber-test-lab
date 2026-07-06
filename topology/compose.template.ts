import { stringify } from "yaml";
import type { GlobalConfig } from "../lib/config";
import type { Scenario } from "../lib/scenario/schema";
import {
  CKB_DOCKERFILE,
  CKB_RPC_PORT,
  CKB_SERVICE,
  DOCKER_BUILD_CONTEXT,
  FNN_DOCKERFILE,
  FNN_RPC_PORT,
} from "../lib/constants";

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
  healthcheck: Healthcheck;
}

export interface ComposeProject {
  name: string;
  networks: Record<string, { name: string; driver: string }>;
  services: Record<string, ComposeService>;
}

/** Tên network cô lập theo run-id — hai lần `up` song song không dẫm chân nhau. */
export function networkName(config: GlobalConfig, runId: string): string {
  return `${config.dockerNetworkPrefix}_${runId}`;
}

/** Tên container duy nhất toàn cục (docker-level) — derive từ run-id, không hardcode. */
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
      `curl -sf -H 'content-type: application/json' -d '${body}' http://localhost:${FNN_RPC_PORT} || exit 1`,
    ],
    interval: "3s",
    timeout: "5s",
    retries: 20,
    start_period: "10s",
  };
}

/**
 * Sinh compose động từ scenario + run-id: 1 CKB devnet + N node FNN (mỗi node trong `scenario.nodes`).
 * Bất biến: network `flab_<run-id>` (cô lập), container prefix run-id, KHÔNG bind port ra host.
 * FNN config chi tiết (key, cell_deps, peers) do orchestrator sinh khi `up` (E3-4) — ở đây chỉ dựng topology.
 */
export function buildComposeProject(
  scenario: Scenario,
  runId: string,
  config: GlobalConfig,
): ComposeProject {
  if (!runId) throw new Error("buildComposeProject: runId rỗng");

  if (scenario.nodes.length > config.maxNodesPerScenario) {
    throw new Error(
      `Scenario "${scenario.name}" có ${scenario.nodes.length} node, vượt maxNodesPerScenario=${config.maxNodesPerScenario} (giới hạn tài nguyên máy).`,
    );
  }
  if (scenario.nodes.includes(CKB_SERVICE)) {
    throw new Error(
      `Tên node "${CKB_SERVICE}" trùng service CKB devnet — đổi tên node trong scenario.`,
    );
  }

  const net = networkName(config, runId);
  const services: Record<string, ComposeService> = {
    [CKB_SERVICE]: {
      container_name: containerName(config, runId, CKB_SERVICE),
      build: { context: DOCKER_BUILD_CONTEXT, dockerfile: CKB_DOCKERFILE },
      networks: [net],
      restart: "unless-stopped",
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
        FNN_NODE_NAME: node,
        CKB_RPC_URL: `http://${CKB_SERVICE}:${CKB_RPC_PORT}`,
      },
      healthcheck: fnnHealthcheck(),
    };
  }

  return {
    name: net,
    networks: { [net]: { name: net, driver: "bridge" } },
    services,
  };
}

/** Serialize project thành YAML để `docker compose -f - up`. */
export function renderComposeYaml(project: ComposeProject): string {
  return stringify({
    name: project.name,
    networks: project.networks,
    services: project.services,
  });
}
