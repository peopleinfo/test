import { zip } from "zip-a-folder";
import { rm } from 'fs/promises';

const main = async () => {
try {
  await rm('./dist.zip', { force: true });
} catch (error) {
  // Ignore error if file doesn't exist
}
  await zip("./client/dist", "./dist.zip", { destPath: "dist" });
};

main().catch(console.error);
