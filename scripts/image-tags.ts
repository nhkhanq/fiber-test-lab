import { loadConfig } from "../lib/config";
import { CKB_VERSION } from "../lib/constants";
import { contextDigest, imageTags } from "../lib/docker/images";

const { fnnVersion } = loadConfig();
const images = imageTags(fnnVersion, await contextDigest());

console.log(`fnn=${images.fnn}`);
console.log(`ckb=${images.ckb}`);
console.log(`fnn_version=${fnnVersion}`);
console.log(`ckb_version=${CKB_VERSION}`);
