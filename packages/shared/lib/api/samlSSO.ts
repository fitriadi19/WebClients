export const getSAMLConfigs = () => ({
    url: 'core/v4/saml/configs',
    method: 'GET',
});

export const getSAMLStaticInfo = () => ({
    url: 'core/v4/saml/sp/info',
    method: 'GET',
});

export const setupSAMLUrl = (data: { DomainID: string; MetadataURL: string }) => ({
    url: 'core/v4/saml/setup/url',
    method: 'POST',
    data,
});

export const setupSAMLXml = (data: { DomainID: string; XML: string }) => ({
    url: 'core/v4/saml/setup/xml',
    method: 'POST',
    data,
});

export const setupSAMLFields = (data: {
    DomainID: string;
    SSOURL: string;
    SSOEntityID: string;
    Certificate: string;
}) => ({
    url: 'core/v4/saml/setup/fields',
    method: 'POST',
    data,
});

export const updateSAMLConfig = (
    uid: string,
    data: {
        DomainID: string;
        SSOURL: string;
        SSOEntityID: string;
        Certificate: string;
    }
) => ({
    url: `core/v4/saml/configs/${uid}/fields`,
    method: 'PUT',
    data,
});
