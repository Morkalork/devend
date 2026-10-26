/**
 * Firebase Test Lab's way in (DEVICE_LAB.md): a "game loop" test launches the
 * APK with a TEST_LOOP intent, the app plays its scenario and writes a results
 * file, then closes. The native half is TestLoopPlugin.java: it says whether
 * this launch was one, and takes the result to write. Here the scenario is the
 * device check, and the result is its report.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { onDeviceCheckDone, requestDeviceCheck } from "./launch";

interface TestLoopPluginApi {
  /** Whether Test Lab launched the app, and which scenario it asked for. */
  launch(): Promise<{ testLoop: boolean; scenario: number }>;
  /** Write the result to Test Lab's file and close the app. */
  finish(options: { result: string }): Promise<void>;
}

const TestLoopPlugin = registerPlugin<TestLoopPluginApi>("TestLoop");

/** Called once from main.tsx. Nothing at all outside a Test Lab launch of the app. */
export async function installTestLoop(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  let launch: { testLoop: boolean; scenario: number };
  try {
    launch = await TestLoopPlugin.launch();
  } catch {
    // An app built before the plugin: no Test Lab launch to answer.
    return;
  }
  if (!launch.testLoop) {
    return;
  }
  onDeviceCheckDone((result, run) => {
    if (run.source === "testLoop") {
      void TestLoopPlugin.finish({ result: JSON.stringify(result, null, 2) });
    }
  });
  await requestDeviceCheck("testLoop");
}
