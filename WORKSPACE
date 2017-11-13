workspace(name = "angular_material_src")
load("@bazel_tools//tools/build_defs/repo:git.bzl", "git_repository")


# Add nodejs rules
git_repository(
  name = "build_bazel_rules_nodejs",
  remote = "https://github.com/bazelbuild/rules_nodejs.git",
  tag = "0.2.2",
)

# NOTE: this rule installs nodejs, npm, and yarn, but does NOT install
# your npm dependencies. You must still run the package manager.
load("@build_bazel_rules_nodejs//:defs.bzl", "node_repositories")
node_repositories(package_json = ["//:package.json"])

# Add sass rules
git_repository(
  name = "io_bazel_rules_sass",
  remote = "https://github.com/bazelbuild/rules_sass.git",
  tag = "0.0.2",
)

load("@io_bazel_rules_sass//sass:sass.bzl", "sass_repositories")
sass_repositories()

# Add TypeScript rules
local_repository(
  name = "build_bazel_rules_typescript",
  path = "node_modules/@bazel/typescript",
)

# Add Angular rules
local_repository(
  name = "angular",
  path = "node_modules/@angular/bazel",
)
