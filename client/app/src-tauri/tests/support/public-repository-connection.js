export default () => {
  const valid = (value) =>
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
  const configured = async (host) => {
    let file;
    try {
      file = await host.config.read("sources.json");
    } catch {
      throw new Error("configuration-unavailable");
    }
    const sources = JSON.parse(file.text);
    if (!Array.isArray(sources) || !sources.length)
      throw new Error("not-configured");
    return sources;
  };
  const read = async ({ sources }, host) => {
    const allowed = await configured(host);
    if (
      !Array.isArray(sources) ||
      !sources.length ||
      sources.some((id) => !valid(id) || !allowed.includes(id))
    )
      throw new Error("source-not-selected");
    const result = [];
    for (const id of sources) {
      const response = await host.network.request({
        url: `https://api.github.com/repos/${id}`,
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Situate-Public-Repository-Qualification",
        },
      });
      if (response.status === 401 || response.status === 403)
        throw new Error("access-denied");
      if (response.status === 404) throw new Error("missing-resource");
      if (response.status !== 200)
        throw new Error(`http-failure:${response.status}`);
      const repo = JSON.parse(response.body);
      if (
        repo.full_name !== id ||
        typeof repo.private !== "boolean" ||
        repo.private ||
        typeof repo.html_url !== "string" ||
        repo.html_url !== `https://github.com/${id}` ||
        typeof repo.default_branch !== "string"
      )
        throw new Error("invalid-repository");
      result.push({
        fullName: repo.full_name,
        url: repo.html_url,
        branch: repo.default_branch,
      });
    }
    return result;
  };
  const configure = async ({ sources, expectedRevision }, host) => {
    if (
      !Array.isArray(sources) ||
      !sources.length ||
      sources.some((id) => !valid(id)) ||
      new Set(sources).size !== sources.length
    )
      throw new Error("invalid-sources");
    const outcome = await host.config
      .write("sources.json", JSON.stringify(sources), expectedRevision)
      .catch(() => {
        throw new Error("configuration-save-unconfirmed");
      });
    if (!outcome?.Saved) throw new Error("configuration-save-unconfirmed");
    return { content: [], details: { sources, outcome } };
  };
  return {
    exports: { read, configure },
    tools: [
      {
        name: "configure",
        description:
          "Replace the explicit public repository source list; no authentication is used.",
        parameters: {
          type: "object",
          properties: {
            sources: { type: "array", items: { type: "string" } },
            expectedRevision: { type: ["string", "null"] },
          },
          required: ["sources", "expectedRevision"],
        },
        execute: configure,
      },
    ],
  };
};
