/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildExtendBehaviorTable, DevContainerConfig, DevContainerConfigKey, ExtendBehavior, PossibleDevContainerConfig } from './configuration';

export async function applyMergeStrategyToObjects(parentValue: Object, childValue: Object, strategy: ExtendBehavior): Promise<any>
{
    let outputValue;
    switch(strategy) {
        case ExtendBehavior.REPLACE:
            outputValue = childValue;
            break;
        case ExtendBehavior.SKIP:
            outputValue = parentValue;
            break;
        case ExtendBehavior.MERGE:
            outputValue = await checkValidityAndReturnUnionArray(parentValue, childValue);
            break;
    }

    return outputValue;
}

export async function applyMergeStrategyToDocuments(parentDocument: any, childDocument: any): Promise<DevContainerConfig> 
{
    const UnionListOfDocumentKeys = [ ...new Set([...Object.keys(parentDocument), ...Object.keys(childDocument)]) ] as DevContainerConfigKey[];
    const ExtendBehaviorTable = buildExtendBehaviorTable();
    let ResultingJSONDocument: Partial<PossibleDevContainerConfig> = {};

    for (let key of UnionListOfDocumentKeys)
    {
        
        // console.log('Evaluating key:' + key);
        // console.log('Parent value:', parentDocument[key]);
        // console.log('Child value:', childDocument[key]);
        // console.log('Extend Behavior:', getDefinedBehaviorOrDefault(ExtendBehaviorTable[key]));
        
        ResultingJSONDocument[key] = await applyMergeStrategyToObjects(
            parentDocument[key], 
            childDocument[key], 
            getDefinedBehaviorOrDefault(ExtendBehaviorTable[key])
        );
    }

    return ResultingJSONDocument as DevContainerConfig;
}

function getDefinedBehaviorOrDefault(behavior: ExtendBehavior): ExtendBehavior
{
    if (behavior === undefined)
    {
        return ExtendBehavior.REPLACE;
    }
    else {
        return behavior;
    }
}

async function checkValidityAndReturnUnionArray(obj1: Object, obj2: Object): Promise<Object> 
{
    if (Array.isArray(obj1) && Array.isArray(obj2))
    {
        return [ ...new Set([...Object.values(obj1), ...Object.values(obj2)]) ];
    }
    else {
        throw new Error('Object inputs aren\'t arrays');
    }
}
