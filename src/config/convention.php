<?php

// 惯例配置

use App\Enums\ConfigKey;
use App\Enums\GroupConfigKey;
use App\Enums\ImagePermission;
use App\Enums\Mail\SmtpOption;
use App\Enums\PastedAction;
use App\Enums\Scan\AliyunOption;
use App\Enums\Scan\NsfwJsOption;
use App\Enums\Scan\TencentOption;
use App\Enums\UserConfigKey;
use App\Enums\Watermark\FontOption;
use App\Enums\Watermark\ImageOption;
use App\Enums\Watermark\Mode;

return [
    'app' => [
        ConfigKey::AppName => 'Lsky Pro',
        ConfigKey::SiteKeywords => 'Lsky Pro,lsky,兰空图床',
        ConfigKey::SiteDescription => 'Lsky Pro, Your photo album on the cloud.',
        ConfigKey::SiteNotice => '',
        ConfigKey::IcpNo => '',
        ConfigKey::IsEnableRegistration => 1,
        ConfigKey::IsEnableApi => 1,
        ConfigKey::IsAllowGuestUpload => 1,
        ConfigKey::UserInitialCapacity => 512000,
        ConfigKey::IsUserNeedVerify => 0,
        ConfigKey::Mail => [
            'default' => 'smtp',
            'mailers' => [
                'smtp' => [
                    SmtpOption::Transport => 'smtp',
                    SmtpOption::Host => 'smtp.mailgun.org',
                    SmtpOption::Port => 587,
                    SmtpOption::Encryption => 'tls',
                    SmtpOption::Username => '',
                    SmtpOption::Password => '',
                    SmtpOption::Timeout => null,
                ]
            ],
        ],
    ],
    'group' => [
        GroupConfigKey::MaximumFileSize => 5120,
        GroupConfigKey::ConcurrentUploadNum => 3,
        GroupConfigKey::IsEnableScan => 0,
        GroupConfigKey::IsEnableWatermark => 0,
        GroupConfigKey::IsEnableOriginalProtection => 0,
        GroupConfigKey::ScannedAction => 'mark', // in mark or delete
        GroupConfigKey::ScanConfigs => [
            'driver' => 'tencent',
            'drivers' => [
                'tencent' => [
                    TencentOption::Endpoint => 'ims.tencentcloudapi.com',
                    TencentOption::SecretId => '',
                    TencentOption::SecretKey => '',
                    TencentOption::Region => '',
                    TencentOption::BizType => ''
                ],
                'aliyun' => [
                    AliyunOption::AccessKeyId => '',
                    AliyunOption::AccessKeySecret => '',
                    AliyunOption::RegionId => '',
                    AliyunOption::Scenes => ['porn'],
                    AliyunOption::BizType => '',
                ],
                'nsfwjs' => [
                    NsfwJsOption::ApiUrl => '',
                    NsfwJsOption::AttrName => 'image',
                    NsfwJsOption::Threshold => 60,
                ]
            ],
        ],
        GroupConfigKey::WatermarkConfigs => [
            'mode' => Mode::Overlay,
            'driver' => 'font',
            'drivers' => [
                'font' => [
                    FontOption::Text => 'Lsky Pro',
                    FontOption::Position => 'bottom-right',
                    FontOption::Angle => 0,
                    FontOption::Size => 50,
                    FontOption::Font => '',
                    FontOption::Color => '#000000',
                    FontOption::X => 10,
                    FontOption::Y => 10,
                ],
                'image' => [
                    ImageOption::Image => '',
                    ImageOption::Position => 'bottom-right',
                    ImageOption::Opacity => 100,
                    ImageOption::Rotate => 0,
                    ImageOption::Width => 0,
                    ImageOption::Height => 0,
                    ImageOption::X => 10,
                    ImageOption::Y => 10,
                ]
            ],
        ],
        GroupConfigKey::LimitPerMinute => 20,
        GroupConfigKey::LimitPerHour => 100,
        GroupConfigKey::LimitPerDay => 300,
        GroupConfigKey::LimitPerWeek => 600,
        GroupConfigKey::LimitPerMonth => 999,
        // fork（F3）：后缀白名单移除 svg —— 不再把 SVG 当成可上传/可存储/可内联展示的图片格式
        // （原图直出时是 image/svg+xml，SVG 内嵌脚本 = 同源存储型 XSS）。本地也不需要 SVG 上传。
        GroupConfigKey::AcceptedFileSuffixes => ['jpeg', 'jpg', 'png', 'gif', 'tif', 'bmp', 'ico', 'psd', 'webp'],
        GroupConfigKey::ImageSaveFormat => '',
        // fork（2026-10-05）：图床要原汁原味 —— 新建角色组 / 全新安装的默认保存质量 75 → 100
        // （存量角色组的存库值不受影响：Utils::parseConfigs() 是 array_merge_recursive_distinct(默认, 库里)，库里赢）。
        GroupConfigKey::ImageSaveQuality => 100,
        GroupConfigKey::PathNamingRule => '{Y}/{m}/{d}',
        GroupConfigKey::FileNamingRule => '{uniqid}',
        GroupConfigKey::ImageCacheTtl => 2626560,
    ],
    'user' => [
        UserConfigKey::DefaultAlbum => 0,
        UserConfigKey::DefaultStrategy => 0,
        UserConfigKey::DefaultPermission => ImagePermission::Private,
        UserConfigKey::PastedAction => PastedAction::Waiting,
        UserConfigKey::IsAutoClearPreview => false,
    ]
];
