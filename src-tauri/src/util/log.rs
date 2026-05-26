use std::path::PathBuf;

use log::LevelFilter;
use log4rs::append::console::ConsoleAppender;
use log4rs::append::rolling_file::policy::compound::trigger::size::SizeTrigger;
use log4rs::append::rolling_file::policy::compound::CompoundPolicy;
use log4rs::append::rolling_file::policy::compound::roll::fixed_window::FixedWindowRoller;
use log4rs::append::rolling_file::RollingFileAppender;
use log4rs::config::{Appender, Config, Root};
use log4rs::encode::pattern::PatternEncoder;

pub fn init_logging() {
    let log_dir = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("logs");

    std::fs::create_dir_all(&log_dir).ok();

    let log_file = log_dir.join("module-agent.log");
    let archive_pattern = log_dir
        .join("module-agent.{}.log")
        .to_string_lossy()
        .to_string();

    // 滚动策略：单文件 10MB，保留 5 个备份
    let roller = FixedWindowRoller::builder()
        .base(1)
        .build(&archive_pattern, 5)
        .expect("构建日志滚动器失败");

    let trigger = SizeTrigger::new(10 * 1024 * 1024);

    let policy = CompoundPolicy::new(Box::new(trigger), Box::new(roller));

    let file_appender = RollingFileAppender::builder()
        .encoder(Box::new(PatternEncoder::new(
            "{d(%Y-%m-%d %H:%M:%S%.3f)} [{l}] {m}{n}",
        )))
        .build(log_file, Box::new(policy))
        .expect("构建文件日志 Appender 失败");

    let stderr_appender = ConsoleAppender::builder()
        .target(log4rs::append::console::Target::Stderr)
        .encoder(Box::new(PatternEncoder::new("{d(%H:%M:%S)} [{l}] {m}{n}")))
        .build();

    let config = Config::builder()
        .appender(Appender::builder().build("file", Box::new(file_appender)))
        .appender(Appender::builder().build("stderr", Box::new(stderr_appender)))
        .build(
            Root::builder()
                .appender("file")
                .appender("stderr")
                .build(LevelFilter::Info),
        )
        .expect("构建日志配置失败");

    log4rs::init_config(config).expect("初始化日志系统失败");
}
