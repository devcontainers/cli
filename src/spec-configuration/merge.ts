/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildExtendBehaviorTable, ExtendBehavior } from './configuration';

export async function ApplyMergeStrategyToObjects(key: string, parentValue: object, childValue: object, strategy: ExtendBehavior): Promise<Object>
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
            outputValue = await CheckValidityAndReturnUnionArray(parentValue, childValue);
            break;
    }

    let outputJSON = {[key]: outputValue};

    return outputJSON;
}

export async function ApplyMergeStrategyToDocuments(parentDocument: any, childDocument: any): Promise<Object> 
{
    let UnionListOfDocumentKeys = [... new Set([...Object.keys(parentDocument), ...Object.keys(childDocument)])];
    let ResultingJSONDocument:any = {};
    let ExtendBehaviorTable:any = buildExtendBehaviorTable();

    for (let key of UnionListOfDocumentKeys)
    {
        /*
        console.log("Evaluating key:" + key);
        console.log("Parent value:" + parentDocument[key]);
        console.log("Child value:" + childDocument[key]);
        console.log("Extend Behavior:" + ExtendBehaviorTable[key]);
        */

        ResultingJSONDocument[key] = ApplyMergeStrategyToObjects(key, 
                                                                       parentDocument[key], 
                                                                       childDocument[key], 
                                                                       ExtendBehaviorTable[key]);
    }

    return ResultingJSONDocument;
}

async function CheckValidityAndReturnUnionArray(obj1: object, obj2: object): Promise<Object> 
{
    if (Array.isArray(obj1) && Array.isArray(obj2))
    {
        return [... new Set([...Object.values(obj1), ...Object.values(obj2)])];
    }
    else {
        throw new Error('Object inputs aren\'t arrays');
    }
}
