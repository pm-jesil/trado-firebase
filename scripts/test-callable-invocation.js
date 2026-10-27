/**
 * End-to-End Emulator Callable Function Invocation Test
 * Verifies that the Functions emulator discovers the exported functions
 * and that healthCheck can be successfully invoked over HTTP.
 */

async function testHealthCheck() {
  console.log("=== Testing Cloud Functions Emulator Callable Invocation ===");
  const url = "http://127.0.0.1:5001/trado-x/asia-south1/healthCheck";
  console.log(`Invoking callable endpoint: ${url}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: {} }),
  });

  const status = response.status;
  const json = await response.json();

  console.log(`HTTP Status: ${status}`);
  console.log("Response payload:", JSON.stringify(json, null, 2));

  if (status !== 200) {
    console.error(`FAIL: Expected HTTP 200, got ${status}`);
    process.exit(1);
  }

  if (json.result?.status !== "ok" || json.result?.service !== "trado-firebase-functions") {
    console.error("FAIL: Unexpected response payload structure!");
    process.exit(1);
  }

  console.log("\n[PASS] Health check callable invoked successfully in emulator!\n");
}

testHealthCheck().catch((err) => {
  console.error("Invocation error:", err);
  process.exit(1);
});
