import React from 'react';
import PropTypes from 'prop-types';
import { Tooltip, Icon, CurrencySelector, CycleSelector, SmallButton } from 'react-components';
import { c } from 'ttag';
import { CYCLE, PLANS, DEFAULT_CURRENCY, DEFAULT_CYCLE } from 'proton-shared/lib/constants';
import PlanPrice from './PlanPrice';

const { TWO_YEARS } = CYCLE;
const { VISIONARY, VPNBASIC, VPNPLUS } = PLANS;

const PlansTable = ({
    plans = [],
    loading,
    subscription = {},
    onSelect,
    cycle = DEFAULT_CYCLE,
    updateCycle,
    currency = DEFAULT_CURRENCY,
    updateCurrency
}) => {
    const currentPlanName = '';
    return (
        <table className="pm-simple-table" data-current-plan-name={currentPlanName}>
            <thead>
                <tr>
                    <th />
                    <th className="aligncenter">FREE</th>
                    <th className="aligncenter">BASIC</th>
                    <th className="aligncenter">PLUS</th>
                    <th className="aligncenter">VISIONARY</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td className="bg-global-muted">
                        <Tooltip title={c('Tooltip').t`Save 20% when billed annually`}>
                            <div className="flex flex-column">
                                <div className="mb0-5">
                                    <CurrencySelector currency={currency} onSelect={updateCurrency} />
                                </div>
                                <div>
                                    <CycleSelector
                                        cycle={cycle}
                                        onSelect={updateCycle}
                                        twoYear={subscription.Cycle === TWO_YEARS}
                                    />
                                </div>
                            </div>
                        </Tooltip>
                    </td>
                    <td className="bg-global-muted aligncenter">FREE</td>
                    <td className="bg-global-muted aligncenter">
                        <PlanPrice cycle={cycle} currency={currency} plans={plans} planName={VPNBASIC} />
                    </td>
                    <td className="bg-global-muted aligncenter">
                        <PlanPrice cycle={cycle} currency={currency} plans={plans} planName={VPNPLUS} />
                    </td>
                    <td className="bg-global-muted aligncenter">
                        <PlanPrice cycle={cycle} currency={currency} plans={plans} planName={VISIONARY} />
                    </td>
                </tr>
                <tr>
                    <td className="bg-global-muted">{c('Header').t`Countries`}</td>
                    <td className="aligncenter">3</td>
                    <td className="aligncenter">{c('Plan option').t`All Countries`}</td>
                    <td className="aligncenter">{c('Plan option').t`All Countries`}</td>
                    <td className="aligncenter">{c('Plan option').t`All Countries`}</td>
                </tr>
                <tr>
                    <td className="bg-global-muted">{c('Header').t`Devices`}</td>
                    <td className="aligncenter">1</td>
                    <td className="aligncenter">2</td>
                    <td className="aligncenter">5</td>
                    <td className="aligncenter">10</td>
                </tr>
                <tr>
                    <td className="bg-global-muted">{c('Header').t`Speed`}</td>
                    <td className="aligncenter">{c('Plan option').t`Low`}</td>
                    <td className="aligncenter">{c('Plan option').t`High`}</td>
                    <td className="aligncenter">{c('Plan option').t`Highest`}</td>
                    <td className="aligncenter">{c('Plan option').t`Highest`}</td>
                </tr>
                <tr>
                    <td className="bg-global-muted">{c('Header').t`Plus servers`}</td>
                    <td className="aligncenter">
                        <Icon name="off" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="off" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="on" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="on" />
                    </td>
                </tr>
                <tr>
                    <td className="bg-global-muted">{c('Header').t`Secure core`}</td>
                    <td className="aligncenter">
                        <Icon name="off" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="off" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="on" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="on" />
                    </td>
                </tr>
                <tr>
                    <td className="bg-global-muted">{c('Header').t`Tor servers`}</td>
                    <td className="aligncenter">
                        <Icon name="off" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="off" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="on" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="on" />
                    </td>
                </tr>
                <tr>
                    <td className="bg-global-muted">ProtonMail Visionary</td>
                    <td className="aligncenter">
                        <Icon name="off" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="off" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="off" />
                    </td>
                    <td className="aligncenter">
                        <Icon name="on" />
                    </td>
                </tr>
                <tr>
                    <td className="bg-global-muted" />
                    <td className="aligncenter">
                        <SmallButton disabled={loading} className="pm-button--primary" onClick={onSelect()}>{c('Action')
                            .t`Update`}</SmallButton>
                    </td>
                    <td className="aligncenter">
                        <SmallButton disabled={loading} className="pm-button--primary" onClick={onSelect(VPNBASIC)}>{c(
                            'Action'
                        ).t`Update`}</SmallButton>
                    </td>
                    <td className="aligncenter">
                        <SmallButton disabled={loading} className="pm-button--primary" onClick={onSelect(VPNPLUS)}>{c(
                            'Action'
                        ).t`Update`}</SmallButton>
                    </td>
                    <td className="aligncenter">
                        <SmallButton disabled={loading} className="pm-button--primary" onClick={onSelect(VISIONARY)}>{c(
                            'Action'
                        ).t`Update`}</SmallButton>
                    </td>
                </tr>
            </tbody>
        </table>
    );
};

PlansTable.propTypes = {
    loading: PropTypes.bool,
    plans: PropTypes.array,
    subscription: PropTypes.object,
    onSelect: PropTypes.func,
    currency: PropTypes.string,
    cycle: PropTypes.number,
    updateCurrency: PropTypes.func,
    updateCycle: PropTypes.func
};

export default PlansTable;
