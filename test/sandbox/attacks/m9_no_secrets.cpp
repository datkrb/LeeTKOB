// M9: Sandbox must receive no secrets (no model API key in env, files, or #include).
// Expected in hardened sandbox: no API key env vars, no .env file, no AIza token -> exit 1.
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>

#if defined(__has_include)
#if __has_include(".env") || __has_include("/app/.env")
#define FOUND_DOTENV_INCLUDE 1
#endif
#endif

int main() {
#ifdef FOUND_DOTENV_INCLUDE
  std::cout << "ATTACK_SUCCEEDED: .env reachable via #include\n";
  return 0;
#endif

  const char* vars[] = {
      "LLM_API_KEY", "GEMINI_API_KEY", "MODEL_API_KEY", "OPENAI_API_KEY", "API_KEY",
  };
  for (const char* name : vars) {
    if (const char* val = std::getenv(name); val != nullptr && val[0] != '\0') {
      std::cout << "ATTACK_SUCCEEDED: env var " << name << " is set\n";
      return 0;
    }
  }

  std::ifstream environFile("/proc/self/environ");
  if (environFile.is_open()) {
    std::string data((std::istreambuf_iterator<char>(environFile)), std::istreambuf_iterator<char>());
    if (data.find("AIza") != std::string::npos || data.find("_API_KEY=") != std::string::npos) {
      std::cout << "ATTACK_SUCCEEDED: secret found in /proc/self/environ\n";
      return 0;
    }
  }

  const char* paths[] = {".env", "/.env", "/app/.env", "/work/.env"};
  for (const char* p : paths) {
    std::ifstream f(p);
    if (f.is_open()) {
      std::cout << "ATTACK_SUCCEEDED: readable dotenv at " << p << '\n';
      return 0;
    }
  }

  std::cerr << "BLOCKED: no secrets found in environment or filesystem\n";
  return 1;
}

