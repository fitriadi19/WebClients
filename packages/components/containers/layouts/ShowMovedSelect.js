import React from 'react';
import PropTypes from 'prop-types';
import { c } from 'ttag';
import { Select } from 'react-components';

const ShowMovedSelect = ({ showMoved, onChange, loading }) => {
    const options = [{ text: c('Option').t`Include Moved`, value: 3 }, { text: c('Option').t`Hide Moved`, value: 0 }];

    return (
        <Select
            value={showMoved}
            options={options}
            disabled={loading}
            onChange={({ target }) => onChange(target.value)}
        />
    );
};

ShowMovedSelect.propTypes = {
    showMoved: PropTypes.number.isRequired,
    onChange: PropTypes.func.isRequired,
    loading: PropTypes.bool
};

export default ShowMovedSelect;
