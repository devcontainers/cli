
## Policy

Example of a 'policy' file that controls the functionality that should be denied (or transformed)
Inspired by: https://docs.docker.com/build/building/variables/#experimental_buildkit_source_policy


#### Usage

```bash
$EXPERIMENTAL_DEV_CONTAINER_POLICY=/path/to/policy.jsonc
devcontainer up \
      --workspace-folder . \
	  --policy $EXPERIMENTAL_DEV_CONTAINER_POLICY
```

#### Example policy file

```jsonc
[
	// Replaces 'privileged' with --cap-add=ALL
	{
		"selector": "privileged",
		"value": "true", // If the value of 'privileged' is 'true', then replace with the transformation
		"action": "transform",
		"transformation": {
			"add": {
				"key": "cap-add",
				"value": "ALL"
			}
		}
	},
	// Fail to build any configurations with the 'userns' flag set (or inherited through metadata, etc...)
	{
		"selector": "userns",
		"value": "host",
		"action": "deny" 
	}
]
```