/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtendBehavior } from '../spec-configuration/configuration';

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

async function CheckValidityAndReturnUnionArray(obj1: object, obj2: object): Promise<Object> 
{
    if (Array.isArray(obj1) && Array.isArray(obj2))
    {
        return obj1.concat(obj2);
    }
    else {
        throw new Error('Object inputs aren\'t arrays');
    }
}
