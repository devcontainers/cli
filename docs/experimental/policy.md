
## Policy Constraints

> This feature is marked as EXPERIMENTAL and may be removed and/or changed in the future.  Please do not rely on this feature for anything other than experimentation. 

Inspired by [BuildKit Source Policy](http://docs.docker.com/build/building/variables/#experimental_buildkit_source_policy), the policy feature allows for the enforcement of certain conditions on the devcontainer configuration.  This can be used to enforce certain security policies, or to enforce certain best practices. Products that embed the dev container CLI (ie Codespaces) may find it useful to enforce certain policies provided by an organization, or to block certain "impossible" operations specific to the given client/environment/provider.

#### Usage

```bash
EXPERIMENTAL_DEV_CONTAINER_POLICY=/path/to/policy.jsonc
devcontainer up \
      --workspace-folder . \
	  --experimental-policy-file $EXPERIMENTAL_DEV_CONTAINER_POLICY
```

#### Example policy file

```jsonc
[
	// Fail to build any configurations with the 'userns' flag set (or inherited through metadata, etc...)
	// This would need to be set through `runArgs` since there's no dev container property for this
	{
		"action": "deny",
		"selector": "userns"
	},
	// Silently filter (remove) the 'initializeCommand' property from any configs, and then carry on
	{
		"action": "filter",
		"selector": "initializeCommand"
	},
	// Fail to build any configurations that have a 'privileged' flag set
	// This flag could be in runArg or inherited through Feature metadata
	{
		"action": "deny",
		"selector": "privileged"
	},
]
```

### Future enhancements

- [ ] A 'transform' action could be added to allow for more complex transformations, such as replacing a key with a different key, or adding a key to a specific location in the configuration.
- [ ] Provide a 'value' for tighter matching conditions

```jsonc
[
	{
		"selector": "privileged",
		"value": "true", // If the value of 'privileged' is 'true', then replace with the transformation
		"action": "transform", // or perhaps "replace"
		"transformation": {
			"add": {
				"key": "cap-add",
				"value": "ALL"
			}
		}
	}
]
```