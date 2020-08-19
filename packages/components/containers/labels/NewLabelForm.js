import React from 'react';
import PropTypes from 'prop-types';
import { c } from 'ttag';
import { LABEL_TYPE, FEATURE_FLAGS } from 'proton-shared/lib/constants';
import { Alert, Input, Label, Row, Field, ColorPicker, Toggle, Info } from '../../components';

import ParentFolderSelector from './ParentFolderSelector';

function NewLabelForm({ label, onChangeColor, onChangeName, onChangeParentID, onChangeNotify }) {
    return (
        <div className="center flex-item-fluid">
            <Row>
                <Label htmlFor="accountName">
                    {label.Type === LABEL_TYPE.MESSAGE_FOLDER
                        ? c('New Label form').t`Folder name`
                        : c('New Label form').t`Label name`}
                </Label>
                <Field>
                    <Input
                        id="accountName"
                        value={label.Name}
                        onChange={onChangeName}
                        placeholder={
                            label.Type === LABEL_TYPE.MESSAGE_FOLDER
                                ? c('New Label form').t`Folder name`
                                : c('New Label form').t`Label name`
                        }
                        required
                        data-test-id="label/folder-modal:name"
                    />
                </Field>
            </Row>
            {label.Type === LABEL_TYPE.MESSAGE_LABEL ? (
                <Row>
                    <Label htmlFor="accountType">{c('New Label form').t`Color`} </Label>
                    <Field>
                        <ColorPicker color={label.Color} onChange={onChangeColor} />
                    </Field>
                </Row>
            ) : null}
            {label.Type === LABEL_TYPE.MESSAGE_FOLDER && FEATURE_FLAGS.includes('sub-folder') ? (
                <>
                    <Alert>{c('Info')
                        .t`Select the parent folder you want to put the new folder in. If no parent folder is selected, the folder will be created as a new top level folder.`}</Alert>
                    <Row>
                        <Label htmlFor="parentID">{c('Label').t`Folder location`}</Label>
                        <Field>
                            <ParentFolderSelector
                                id="parentID"
                                value={label.ParentID}
                                onChange={onChangeParentID}
                                disableOptions={[label.ID]}
                            />
                        </Field>
                    </Row>
                    <Row>
                        <Label htmlFor="notification">
                            <span className="mr0-5">{c('Label').t`Notification`}</span>
                            <Info
                                title={c('Info')
                                    .t`Turn this feature on to receive messages desktop/mobile notifications when messages are automatically added to this folder using custom filters`}
                            />
                        </Label>
                        <Field>
                            <Toggle
                                id="notification"
                                checked={label.Notify === 1}
                                onChange={({ target }) => onChangeNotify(+target.checked)}
                            />
                        </Field>
                    </Row>
                </>
            ) : null}
        </div>
    );
}

NewLabelForm.propTypes = {
    label: PropTypes.object,
    onChangeName: PropTypes.func.isRequired,
    onChangeColor: PropTypes.func.isRequired,
    onChangeParentID: PropTypes.func,
    onChangeNotify: PropTypes.func,
};

export default NewLabelForm;
