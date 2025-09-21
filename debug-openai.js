import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
const model = "gpt-5-nano";

console.log("Testing OpenAI API...");
console.log("Model:", model);
console.log("API Key:", apiKey ? `${apiKey.substring(0, 10)}...` : "NOT SET");

async function testOpenAI() {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant. Always respond with valid JSON.",
          },
          {
            role: "user",
            content: `Return JSON: {"argument": "AI is beneficial", "sources": [{"title": "AI Research", "url": "https://example.com"}]}`,
          },
        ],
      }),
    });

    console.log("Response status:", response.status);
    console.log(
      "Response headers:",
      Object.fromEntries(response.headers.entries())
    );

    const data = await response.json();
    console.log("Response data:", JSON.stringify(data, null, 2));

    if (data.choices && data.choices[0] && data.choices[0].message) {
      console.log("Content:", data.choices[0].message.content);
      console.log("Message object:", JSON.stringify(data.choices[0].message, null, 2));
      console.log("Finish reason:", data.choices[0].finish_reason);
    } else {
      console.log("No content in response");
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

testOpenAI();
